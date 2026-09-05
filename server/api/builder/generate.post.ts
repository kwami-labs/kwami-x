import { z } from 'zod'
import { EXTENSION_RULES, EXTENSION_TEMPLATE, hooksToBitmask } from '#shared/builder/extension-abi'
import { encodeEvent, stripCodeFence, type CodegenEvent } from '#shared/codegen/activity'
import {
  CODEGEN_MAX_TOKENS,
  CODEGEN_TIMEOUT_MS,
  normalizeThinking,
  resolveCodegenModel,
} from '#shared/codegen/config'
import { readVoiceConfig } from '#shared/kwami/voice'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { assertNotDemo } from '~~/server/utils/demo'

const Body = z.object({
  kwamiMint: z.string(),
  name: z.string().min(2).max(64),
  brief: z.string().min(10).max(2000),
  hooks: z.array(z.string()).min(1),
  model: z.string().optional(),
})

/**
 * Generate an Anchor sub-program from a plain-language brief.
 *
 * The model writes Rust; a human deploys it. That separation is not a
 * limitation to be engineered away — a generated program that moves other
 * people's money should be read by its owner before it goes anywhere near a
 * cluster, and the vault's own guarantees are what stop a bad extension from
 * being catastrophic rather than merely broken.
 *
 * `EXTENSION_RULES` is sent to the model and shown to the owner beside the
 * result, so the person approving the deploy is checking the same list the
 * generator was working from.
 *
 * The response is a stream, not a document. A generation takes a minute or more
 * and spends most of it reasoning before the first line of Rust exists, so a
 * route that waited and answered once would show a spinner for that whole
 * minute — which is indistinguishable from a hang. Reasoning and source are
 * relayed as they arrive; see `shared/codegen/activity.ts` for the format.
 *
 * The API key stays here. The browser never sees it, which is the entire reason
 * this is a server route rather than a direct call from the builder page.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const body = Body.parse(await readBody(event))
  const config = useRuntimeConfig()

  if (!config.anthropicApiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'The program builder needs NUXT_ANTHROPIC_API_KEY.',
    })
  }

  const db = serviceClient()
  const { data: kwami } = await db
    .from('kwamis')
    .select('id, name, author_id, state, payout_bps, session_duration, voice')
    .eq('mint', body.kwamiMint)
    .maybeSingle()

  if (!kwami) throw createError({ statusCode: 404, statusMessage: 'No such Kwami.' })
  if (kwami.author_id !== user.id) throw createError({ statusCode: 403, statusMessage: 'Not your Kwami.' })
  if (kwami.state !== 'minted') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Extensions can only be attached before a Kwami first goes live.',
    })
  }

  const { data: record, error: insertError } = await db
    .from('kwami_programs')
    .insert({
      kwami_id: kwami.id,
      author_id: user.id,
      name: body.name,
      brief: body.brief,
      status: 'generating',
      hooks: hooksToBitmask(body.hooks),
    })
    .select('id')
    .single()
  if (insertError) throw createError({ statusCode: 500, statusMessage: insertError.message })

  const model = resolveCodegenModel(body.model)
  const thinking = normalizeThinking(true, model)
  const game = readVoiceConfig(kwami.voice as Record<string, unknown> | null)

  const system = `You write Solana programs with Anchor 0.31 for the Kwami protocol.

A Kwami is an NFT that owns a pot. Challengers pay a ticket for a timed voice session and win ${kwami.payout_bps / 100}% of the pot if they say its secret phrase. Sessions last ${kwami.session_duration} seconds and this Kwami plays a "${game.gameId}" game. You are writing an *extension*: a separate program the Kwami vault calls by CPI at lifecycle moments, which adds game mechanics on top of that base loop.

Hard rules, all of which are non-negotiable:
${EXTENSION_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Start from this scaffold and extend it. Keep the hook signatures exactly as given — the vault calls them by discriminator:

${EXTENSION_TEMPLATE}

Output format: return ONLY Rust source, no markdown fences and no commentary. Comment the code where a reader would otherwise have to guess *why* a rule works the way it does. Do not comment the obvious.`

  setResponseHeader(event, 'Content-Type', 'application/x-ndjson; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')
  // Nitro sits behind proxies that buffer by default, which would hold the whole
  // stream until it closed and undo the entire point of streaming it.
  setResponseHeader(event, 'X-Accel-Buffering', 'no')

  const encoder = new TextEncoder()
  const line = (e: CodegenEvent) => encoder.encode(encodeEvent(e))

  // Abort the upstream call when the consumer disconnects, so an abandoned
  // generation cannot keep burning the deployment's key in the background.
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), CODEGEN_TIMEOUT_MS)

  return new ReadableStream({
    async start(controller) {
      let source = ''

      try {
        controller.enqueue(line({ t: 'phase', phase: 'thinking' }))

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: abort.signal,
          headers: {
            'x-api-key': config.anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: CODEGEN_MAX_TOKENS,
            stream: true,
            thinking,
            system,
            messages: [
              {
                role: 'user',
                content: `Kwami: "${kwami.name}". Hooks to implement: ${body.hooks.join(', ')}.\n\nThe game the owner wants:\n${body.brief}`,
              },
            ],
          }),
        })

        if (!response.ok || !response.body) {
          throw new Error(`Anthropic returned ${response.status}: ${(await response.text()).slice(0, 400)}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let wroteSource = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // Anthropic streams SSE: `event:` and `data:` lines separated by blank
          // lines. Only the data lines carry anything.
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const raw of lines) {
            if (!raw.startsWith('data:')) continue
            const payload = raw.slice(5).trim()
            if (!payload || payload === '[DONE]') continue

            let frame: {
              type?: string
              delta?: { type?: string; text?: string; thinking?: string }
              error?: { message?: string }
            }
            try {
              frame = JSON.parse(payload)
            } catch {
              continue
            }

            if (frame.type === 'error') throw new Error(frame.error?.message ?? 'Upstream stream error.')
            if (frame.type !== 'content_block_delta') continue

            if (frame.delta?.type === 'thinking_delta' && frame.delta.thinking) {
              controller.enqueue(line({ t: 'thinking', d: frame.delta.thinking }))
            } else if (frame.delta?.type === 'text_delta' && frame.delta.text) {
              if (!wroteSource) {
                wroteSource = true
                controller.enqueue(line({ t: 'phase', phase: 'writing' }))
              }
              source += frame.delta.text
              controller.enqueue(line({ t: 'source', d: frame.delta.text }))
            }
          }
        }

        const cleaned = stripCodeFence(source)
        if (!cleaned) throw new Error('The model returned no source.')

        controller.enqueue(line({ t: 'phase', phase: 'checking' }))
        await db.from('kwami_programs').update({ source: cleaned, status: 'built' }).eq('id', record.id)

        controller.enqueue(
          line({ t: 'result', id: record.id as string, source: cleaned, rules: EXTENSION_RULES }),
        )
        controller.enqueue(line({ t: 'phase', phase: 'done' }))
        controller.enqueue(line({ t: 'done' }))
      } catch (e) {
        const message = abort.signal.aborted
          ? 'The generation took too long and was stopped.'
          : (e as Error).message
        await db.from('kwami_programs').update({ status: 'failed', build_log: message }).eq('id', record.id)
        // The headers are long gone by here, so the failure has to travel in the
        // stream itself rather than as a status code.
        controller.enqueue(line({ t: 'error', message }))
        controller.enqueue(line({ t: 'phase', phase: 'error' }))
      } finally {
        clearTimeout(timeout)
        controller.close()
      }
    },
    cancel() {
      clearTimeout(timeout)
      abort.abort()
    },
  })
})
