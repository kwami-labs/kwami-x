import { matchSecret, words } from '#shared/game/secret'
import { gameById } from '#shared/kwami/voice'
import { buildKwamiPrompt } from '#shared/kwami/prompt'
import { BRAIN_MODEL } from '#shared/kwami/agent-config'

/**
 * The Kwami's conversational brain.
 *
 * Two implementations behind one interface. With an Anthropic key configured
 * the Kwami is driven by Claude under a guard prompt; without one it falls
 * back to a scripted deflector so the game is playable on a fresh clone.
 *
 * The guard is layered rather than trusted to the prompt alone. A model told
 * "never reveal the secret" will still leak it to a sufficiently clever
 * challenger — that is what makes the game fun — but it must not leak it by
 * accident to someone who simply asked nicely, and it must never emit the
 * phrase verbatim in its own reply, which would let a player win by reading it
 * back off the screen.
 */

export interface BrainInput {
  persona: string
  secret: string
  /**
   * Which contest the creator sold.
   *
   * A challenger reads the game on the profile page and pays on the strength of
   * it, so it has to reach the model — a Kwami advertised as a riddle that then
   * stonewalls has taken money under a description of a different product.
   */
  gameId?: string
  /** 0 = chatty, 1 = adversarial. */
  guardStrength: number
  /**
   * Character, as the creator set it. See `shared/kwami/traits.ts`.
   *
   * Separate from `guardStrength` because they answer different questions.
   * Guard strength decides how hard the thing defends a pot — a game rule a
   * challenger reads before paying. The traits decide who it is while doing so.
   * Optional, because a Kwami minted before traits existed has none, and its
   * prompt should read exactly as it did the day it was minted.
   */
  traits?: unknown
  history: Array<{ role: 'player' | 'kwami'; text: string }>
  utterance: string
  /** Seconds left on the clock — the Kwami taunts differently near the end. */
  secondsLeft: number
  /**
   * Skip the model and answer from the scripted deflector.
   *
   * Set when the Kwami has run out of energy mid-session. The challenger has
   * already paid for their minutes, so the session has to keep running — and
   * this is the same fallback a model outage takes, for the same reason: the
   * win is decided by `matchSecret` against what the *player* says, so a
   * scripted Kwami still leaves them every chance of taking the pot.
   */
  forceScripted?: boolean
}

export async function respond(input: BrainInput): Promise<string> {
  const config = useRuntimeConfig()
  const useModel = config.anthropicApiKey && !input.forceScripted
  const reply = useModel ? await respondWithClaude(input) : respondScripted(input)
  return redactSecret(reply, input.secret)
}

/**
 * Strip the secret from anything the Kwami is about to say.
 *
 * The last line of defence. A model that slips and states the phrase would
 * hand the player a win they did not earn, and no prompt is reliable enough to
 * make that impossible — so the check happens in code, after generation, where
 * it cannot be talked around.
 */
export function redactSecret(reply: string, secret: string): string {
  if (matchSecret(reply, secret, { threshold: 0.9 }).matched) {
    return 'I almost said something I should not have. Ask me differently.'
  }
  return reply
}

async function respondWithClaude(input: BrainInput): Promise<string> {
  const config = useRuntimeConfig()

  const body = {
    model: BRAIN_MODEL,
    max_tokens: 220,
    // The same prompt the voice worker is handed, so a Kwami rehearsed over
    // LiveKit and one played over HTTP are the same character.
    system: buildKwamiPrompt(input),
    messages: [
      ...input.history.slice(-12).map((turn) => ({
        role: turn.role === 'player' ? ('user' as const) : ('assistant' as const),
        content: turn.text,
      })),
      { role: 'user' as const, content: input.utterance },
    ],
  }

  try {
    const response = await $fetch<{ content: Array<{ type: string; text?: string }> }>(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': config.anthropicApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body,
      },
    )
    const text = response.content.find((c) => c.type === 'text')?.text?.trim()
    return text || respondScripted(input)
  } catch {
    // A model outage must not end a paid session. The scripted Kwami keeps
    // the clock meaningful while the player carries on trying.
    return respondScripted(input)
  }
}

const DEFLECTIONS = [
  'You are circling something. Not it, though.',
  'Ask me about the weather. I like the weather.',
  'That is a question. I collect those.',
  'Warmer. Or colder. One of the two.',
  'People have said stranger things in this room.',
  'I could tell you. I have decided not to.',
  'You are spending your minutes on the wrong shape of question.',
  'Mm. Try that again, but meaner.',
] as const

const CLOSING = [
  'Not much time left for you.',
  'The clock does not care how close you are.',
  'Seconds now. Choose your words.',
] as const

/**
 * The no-API-key Kwami.
 *
 * Not a language model — it deflects, echoes and taunts. It is genuinely hard
 * to beat by accident and genuinely impossible to beat by argument, which is
 * the wrong difficulty curve for real play but exactly right for verifying
 * that the *loop* works end to end.
 */
export function respondScripted(input: BrainInput): string {
  const spoken = words(input.utterance)
  const secretWords = words(input.secret)

  if (input.secondsLeft < 25) {
    return pick(CLOSING, input.history.length)
  }

  // The scripted Kwami cannot play a game, but it can at least stay in the one
  // it was sold as. A Confession Kwami that answers like an interrogator would
  // read as the mode having no effect at all.
  const flavour = SCRIPTED_FLAVOUR[gameById(input.gameId).id]
  if (flavour && input.history.length % 3 === 2) {
    return pick(flavour, input.history.length)
  }

  // Acknowledge overlap without confirming anything — enough of a signal to
  // keep someone talking, not enough to narrow the search.
  const overlap = spoken.filter((w) => secretWords.includes(w)).length
  if (overlap > 0 && spoken.length > 2) {
    return 'One of those words has been in this room before. I will not say which.'
  }

  // Checked on the raw utterance: `normalizePhrase` strips punctuation, so
  // looking at the normalised form would make this branch dead.
  if (input.utterance.trimEnd().endsWith('?')) {
    return pick(DEFLECTIONS, input.history.length + 1)
  }

  return pick(DEFLECTIONS, input.history.length)
}

/** One line per game, so the scripted fallback is recognisably in character. */
const SCRIPTED_FLAVOUR: Record<string, readonly [string, ...string[]]> = {
  interrogation: ['You are asking. I am not answering.', 'Next question. Same answer.'],
  riddle: [
    'Closer. Think about what a thing is called before it is named.',
    'You have the shape. Not the sound.',
  ],
  negotiation: ['Offer me something first.', 'You want it. Tell me what it is worth to you.'],
  confession: ['I want to tell you. I open my mouth and — no.', 'It is right there. It will not come out.'],
  trial: ['My turn. Why should I give it to you?', 'Answer me that first, and we will see.'],
}

function pick<T>(list: readonly [T, ...T[]], seed: number): T {
  return list[Math.abs(seed) % list.length]!
}
