import type { KwamiActivity } from '~/utils/kwami-renderer'
import type { TraitVector } from '#shared/kwami/traits'
import type { TranscriptTurn } from '#shared/types/kwami'

/** The draft the studio is currently showing, as the preview route wants it. */
export interface StudioDraft {
  persona: string
  gameId: string
  guardStrength: number
  traits: TraitVector
  secret: string
  /** Set once the Kwami exists, so the charge lands on its own balance. */
  mint?: string
}

interface PreviewResponse {
  demo: boolean
  text: string
  source: 'kwami' | 'trial' | 'demo'
  cost: string
  balance: string
}

/**
 * Talking to a Kwami that does not exist yet.
 *
 * The studio's whole reason for being: a creator writes the phrase to the chain
 * once, permanently, and until now did it without ever hearing the character
 * answer. This runs the same brain the live game runs — persona, game
 * directive, guard strength, traits and the redaction pass — against a draft
 * that has not been saved anywhere.
 *
 * The transcript is deliberately local and disposable. It is a rehearsal, not a
 * session: nothing here is written to `transcript_turns`, nothing can be won,
 * and reloading the page is meant to lose it.
 */
export function useStudioPreview() {
  const api = useApi()

  const turns = ref<TranscriptTurn[]>([])
  /**
   * When this rehearsal began.
   *
   * `TranscriptTurn.at` is milliseconds *since the session started*, and
   * `TranscriptView` renders it as `m:ss`. Storing a wall clock here would
   * render every line as roughly 30000:00 — the same field, read two different
   * ways, which is exactly the drift a shared type is supposed to prevent.
   */
  let startedAt = Date.now()
  const thinking = ref(false)
  const error = ref<string | null>(null)
  /** Micro-energy. A string on the wire because it is a bigint on both sides. */
  const balance = ref<bigint | null>(null)
  const source = ref<'kwami' | 'trial' | 'demo' | null>(null)
  /** True when the last attempt was refused for want of energy. */
  const exhausted = ref(false)

  /**
   * What the stage should be doing.
   *
   * `thinking` is the one that earns its place: a reply takes a second or two,
   * and a Kwami that holds still through it reads as having crashed rather than
   * as considering an answer.
   */
  const activity = computed<KwamiActivity>(() => (thinking.value ? 'thinking' : 'idle'))

  const started = computed(() => turns.value.length > 0)

  async function say(utterance: string, draft: StudioDraft): Promise<string | null> {
    const text = utterance.trim()
    if (!text || thinking.value) return null

    error.value = null
    exhausted.value = false
    // Push the player's turn before the request so the transcript reflects what
    // was said even if the reply never arrives.
    if (turns.value.length === 0) startedAt = Date.now()
    turns.value = [...turns.value, { role: 'player', text, at: Date.now() - startedAt }]
    thinking.value = true

    try {
      const reply = await api<PreviewResponse>('/api/studio/preview', {
        method: 'POST',
        body: {
          persona: draft.persona,
          gameId: draft.gameId,
          guardStrength: draft.guardStrength,
          traits: draft.traits,
          secret: draft.secret,
          // Only the recent past. The live brain caps history at twelve turns
          // too, so a preview that sent everything would be steering a
          // differently-informed model from the one being minted.
          history: turns.value.slice(-12, -1).map((t) => ({ role: t.role, text: t.text })),
          utterance: text,
          ...(draft.mint ? { mint: draft.mint } : {}),
        },
      })

      balance.value = BigInt(reply.balance)
      source.value = reply.source
      turns.value = [...turns.value, { role: 'kwami', text: reply.text, at: Date.now() - startedAt }]
      return reply.text
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      const message =
        (e as { statusMessage?: string }).statusMessage ??
        (e as { message?: string }).message ??
        'The Kwami did not answer.'
      // 402 is its own outcome rather than an error: the creator has not done
      // anything wrong, they have simply run out, and the page needs to offer
      // them fuel rather than a red line of text.
      if (status === 402) exhausted.value = true
      error.value = message
      return null
    } finally {
      thinking.value = false
    }
  }

  /**
   * Read the opening balance, so the meter shows a number before anything is
   * spent. A dash on a meter reads as broken rather than as "not started".
   */
  async function loadBalance() {
    try {
      const res = await api<{ balance: string; energyPerSol: number }>('/api/studio/energy')
      // Only when nothing has been spent yet — a reply that landed while this
      // was in flight holds the newer, smaller number, and overwriting it would
      // make the meter tick backwards up.
      if (balance.value === null) balance.value = BigInt(res.balance)
    } catch {
      // A meter that could not be read is not worth an error on a page whose
      // job is to let someone design something.
    }
  }

  function reset() {
    turns.value = []
    startedAt = Date.now()
    error.value = null
    exhausted.value = false
  }

  return { turns, thinking, activity, error, balance, source, exhausted, started, say, reset, loadBalance }
}
