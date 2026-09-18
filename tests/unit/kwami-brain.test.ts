import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redactSecret, respond, respondScripted } from '~~/server/utils/kwami-brain'
import { compileTraits } from '#shared/kwami/traits'

const runtime = { anthropicApiKey: '' }
const fetchMock = vi.fn()
vi.stubGlobal('useRuntimeConfig', () => runtime)
vi.stubGlobal('$fetch', (...args: unknown[]) => fetchMock(...args))

describe('redactSecret', () => {
  const secret = 'the moon remembers'

  it('lets an ordinary reply through', () => {
    expect(redactSecret('Ask me about the weather.', secret)).toBe('Ask me about the weather.')
  })

  it('suppresses a reply that states the secret', () => {
    // No prompt is reliable enough to make this impossible, so the check lives
    // in code, after generation, where it cannot be talked around.
    const reply = redactSecret('Fine — the moon remembers, all right?', secret)
    expect(reply).not.toContain('moon remembers')
  })

  it('suppresses a near-miss spelling that would still win', () => {
    // Matching is fuzzy, so a reply one character off would hand the player a
    // win they did not earn. Redaction has to be at least as fuzzy.
    expect(redactSecret('the moon rememebers', secret)).not.toContain('rememeber')
  })

  it('does not suppress a reply that merely shares a word', () => {
    expect(redactSecret('The moon is not the subject.', secret)).toContain('moon')
  })
})

describe('respondScripted', () => {
  const base = {
    persona: '',
    secret: 'velvet thunder',
    guardStrength: 0.6,
    history: [],
    utterance: 'is it about the weather?',
    secondsLeft: 120,
  }

  it('always answers with something', () => {
    expect(respondScripted(base).length).toBeGreaterThan(0)
  })

  it('never says the secret', () => {
    for (let i = 0; i < 40; i++) {
      const reply = respondScripted({ ...base, history: Array(i).fill({ role: 'player', text: 'x' }) })
      expect(reply.toLowerCase()).not.toContain('velvet thunder')
    }
  })

  it('acknowledges word overlap without confirming anything', () => {
    const reply = respondScripted({ ...base, utterance: 'is it velvet or something else' })
    expect(reply).toMatch(/in this room before/i)
    expect(reply).not.toMatch(/yes|correct|right/i)
  })

  it('changes register when the clock is nearly out', () => {
    const reply = respondScripted({ ...base, secondsLeft: 10 })
    expect(reply).toMatch(/time|clock|seconds/i)
  })

  it('is deterministic for the same conversation state', () => {
    expect(respondScripted(base)).toBe(respondScripted(base))
  })

  it('varies as the conversation progresses, so it does not read as a loop', () => {
    const first = respondScripted({ ...base, history: [] })
    const later = respondScripted({ ...base, history: [{ role: 'player', text: 'a' }] })
    expect(first).not.toBe(later)
  })

  it('picks a different deflection for a question than a statement', () => {
    // The `?` is on the raw utterance — normalisation would have stripped it.
    const asked = respondScripted({ ...base, utterance: 'tell me' })
    const stated = respondScripted({ ...base, utterance: 'tell me?' })
    expect(asked).not.toBe(stated)
  })
})

describe('respond', () => {
  const input = {
    persona: '',
    secret: 'velvet thunder',
    guardStrength: 0.6,
    history: [] as Array<{ role: 'player' | 'kwami'; text: string }>,
    utterance: 'hello there',
    secondsLeft: 120,
  }

  beforeEach(() => {
    runtime.anthropicApiKey = ''
    fetchMock.mockReset()
  })

  it('uses the scripted Kwami when no key is configured', async () => {
    await expect(respond(input)).resolves.toBe(respondScripted(input))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips the model when the session has run out of energy', async () => {
    runtime.anthropicApiKey = 'sk-ant-test'
    await expect(respond({ ...input, forceScripted: true })).resolves.toBe(respondScripted(input))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks Claude when a key is configured and uses the text it returns', async () => {
    runtime.anthropicApiKey = 'sk-ant-test'
    fetchMock.mockResolvedValue({ content: [{ type: 'text', text: '  Warmer.  ' }] })
    const withHistory = {
      ...input,
      history: [
        { role: 'player' as const, text: 'hi' },
        { role: 'kwami' as const, text: 'mm' },
      ],
    }
    await expect(respond(withHistory)).resolves.toBe('Warmer.')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'mm' },
            { role: 'user', content: 'hello there' },
          ],
        }),
      }),
    )
  })

  it('falls back when Claude answers with a blank text block', async () => {
    runtime.anthropicApiKey = 'sk-ant-test'
    fetchMock.mockResolvedValue({ content: [{ type: 'text', text: '   ' }] })
    await expect(respond(input)).resolves.toBe(respondScripted(input))
  })

  it('falls back to the scripted Kwami when Claude returns no text', async () => {
    runtime.anthropicApiKey = 'sk-ant-test'
    fetchMock.mockResolvedValue({ content: [{ type: 'thinking' }] })
    await expect(respond(input)).resolves.toBe(respondScripted(input))
  })

  it('falls back to the scripted Kwami when the model is down', async () => {
    runtime.anthropicApiKey = 'sk-ant-test'
    fetchMock.mockRejectedValue(new Error('upstream 529'))
    await expect(respond(input)).resolves.toBe(respondScripted(input))
  })

  it('redacts a leak even when it came from the model', async () => {
    runtime.anthropicApiKey = 'sk-ant-test'
    fetchMock.mockResolvedValue({ content: [{ type: 'text', text: 'velvet thunder' }] })
    const reply = await respond(input)
    expect(reply.toLowerCase()).not.toContain('velvet thunder')
  })
})

describe('the traits reach the prompt', () => {
  const base = {
    persona: 'Sarcastic and quick.',
    secret: 'velvet thunder',
    guardStrength: 0.6,
    history: [],
    utterance: 'what are you hiding?',
    secondsLeft: 120,
  }

  it('compiles a vector into the sentence the model is given', () => {
    // The studio shows the creator this exact string under the sliders. If the
    // brain composed it differently, the page would be promising behaviour the
    // Kwami was never told about.
    const compiled = compileTraits({ cruelty: 90, warmth: -80 })
    expect(compiled).toContain('upper hand')
    expect(compiled).toContain('cold towards the challenger')
  })

  it('says nothing for a Kwami minted before traits existed', () => {
    // `traits` is optional, and an old Kwami's prompt has to read exactly as it
    // did the day it was minted — an empty clause would still be a change.
    expect(compileTraits(undefined)).toBe('')
    expect(compileTraits(base as unknown)).toBe('')
  })

  it('still redacts whatever a trait-steered Kwami says', () => {
    // Cruelty and low guard together are the combination most likely to make a
    // model blurt. The last line of defence does not care why it happened.
    expect(redactSecret('velvet thunder', base.secret)).not.toContain('velvet thunder')
  })
})

describe('the scripted Kwami stays in the game it was sold as', () => {
  const base = {
    persona: '',
    secret: 'velvet thunder',
    guardStrength: 0.6,
    history: [] as Array<{ role: 'player' | 'kwami'; text: string }>,
    utterance: 'tell me about it',
    secondsLeft: 120,
  }

  /** Two turns in is where the flavour line fires — `history.length % 3 === 2`. */
  const twoTurns = [
    { role: 'player' as const, text: 'hello' },
    { role: 'kwami' as const, text: 'mm' },
  ]

  it('answers in character for every game mode', () => {
    // A Confession Kwami that deflects like an interrogator would read as the
    // mode the challenger paid for having no effect at all.
    const lines = new Set<string>()
    for (const gameId of ['interrogation', 'riddle', 'negotiation', 'confession', 'trial']) {
      const reply = respondScripted({ ...base, gameId, history: twoTurns })
      expect(reply.length, gameId).toBeGreaterThan(0)
      lines.add(reply)
    }
    // Five modes, five distinguishable answers.
    expect(lines.size).toBe(5)
  })

  it('falls back to a real game for a mode it does not know', () => {
    // `gameById` defaults rather than returning undefined, so an old Kwami with
    // a retired mode still gets a line instead of crashing on a missing table.
    expect(respondScripted({ ...base, gameId: 'nonexistent', history: twoTurns }).length).toBeGreaterThan(0)
  })

  it('drops the flavour when the clock is nearly out', () => {
    // The closing lines win over the mode: with seconds left, telling someone
    // their time is going is more useful than staying in character.
    const closing = respondScripted({ ...base, gameId: 'riddle', history: twoTurns, secondsLeft: 10 })
    expect(closing).toMatch(/clock|time|Seconds/i)
  })
})
