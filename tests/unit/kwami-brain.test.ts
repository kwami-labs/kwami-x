import { describe, expect, it } from 'vitest'
import { redactSecret, respondScripted } from '~~/server/utils/kwami-brain'

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
})
