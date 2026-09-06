import { describe, expect, it } from 'vitest'
import { redactSecret, respondScripted } from '~~/server/utils/kwami-brain'
import { compileTraits } from '#shared/kwami/traits'

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
