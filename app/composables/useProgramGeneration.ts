/**
 * The browser side of the codegen stream.
 *
 * Consumes the NDJSON the builder route emits and exposes it as reactive state:
 * a phase, the reasoning so far, the source so far. The alternative — awaiting a
 * finished document — is a minute of spinner, and the reasoning feed is the only
 * thing that distinguishes a model working from a request that died.
 *
 * The transport is `fetch`, not `$fetch`. `$fetch` buffers the whole response
 * before resolving, which would collect every frame and hand them over at the
 * end: correct output, none of the point.
 */
import { decodeEvents, type CodegenPhase } from '#shared/codegen/activity'
import { STREAM_OPEN_TIMEOUT_MS } from '#shared/codegen/config'

export interface GenerateRequest {
  kwamiMint: string
  name: string
  brief: string
  hooks: string[]
  model?: string
}

export function useProgramGeneration() {
  const auth = useAuthStore()

  const phase = ref<CodegenPhase>('idle')
  const thinking = ref('')
  const source = ref('')
  const rules = ref<string[]>([])
  const programId = ref<string | null>(null)
  const error = ref<string | null>(null)

  const running = computed(() => ['thinking', 'writing', 'checking'].includes(phase.value))

  let controller: AbortController | null = null

  function reset() {
    phase.value = 'idle'
    thinking.value = ''
    source.value = ''
    rules.value = []
    programId.value = null
    error.value = null
  }

  /** Abandon a running generation. The route aborts upstream when we disconnect. */
  function cancel() {
    controller?.abort()
    controller = null
    if (running.value) phase.value = 'idle'
  }

  async function generate(request: GenerateRequest) {
    reset()
    phase.value = 'thinking'
    controller = new AbortController()

    // A stream that never opens is a broken deployment; a stream that opens and
    // then goes quiet is a model thinking. Only the first deserves a short
    // deadline, so the timer is cleared the moment any byte arrives.
    let opened = false
    const openTimer = setTimeout(() => {
      if (!opened) controller?.abort()
    }, STREAM_OPEN_TIMEOUT_MS)

    try {
      const token = auth.session?.access_token
      const response = await fetch('/api/builder/generate', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(request),
      })

      if (!response.ok || !response.body) {
        // A failure before the stream opens still has a status code to travel
        // in, and Nitro puts the reason in the body.
        const detail = await response.text().catch(() => '')
        let message = `The builder refused the request (${response.status}).`
        try {
          const parsed = JSON.parse(detail) as { statusMessage?: string; message?: string }
          message = parsed.statusMessage ?? parsed.message ?? message
        } catch {
          if (detail) message = detail.slice(0, 300)
        }
        throw new Error(message)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        opened = true
        clearTimeout(openTimer)

        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = decodeEvents(buffer)
        buffer = rest

        for (const e of events) {
          switch (e.t) {
            case 'phase':
              phase.value = e.phase
              break
            case 'thinking':
              thinking.value += e.d
              break
            case 'source':
              source.value += e.d
              break
            case 'result':
              // Authoritative: the accumulated deltas are a best effort, this is
              // what was actually stored.
              programId.value = e.id
              source.value = e.source
              rules.value = e.rules
              break
            case 'error':
              error.value = e.message
              break
            case 'done':
              break
          }
        }
      }

      if (error.value) phase.value = 'error'
      else if (!source.value) {
        // The stream ended without a result and without an error record, which
        // means the connection dropped mid-generation.
        error.value = 'The connection closed before the program was finished.'
        phase.value = 'error'
      }
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError'
      error.value = aborted
        ? opened
          ? 'Generation cancelled.'
          : 'The builder did not respond. Check that the server has an Anthropic key configured.'
        : (e as Error).message
      phase.value = 'error'
    } finally {
      clearTimeout(openTimer)
      controller = null
    }

    return source.value || null
  }

  onScopeDispose(() => controller?.abort())

  return { phase, running, thinking, source, rules, programId, error, generate, cancel, reset }
}
