import { describe, expect, it } from 'vitest'
import {
  NEUTRAL_TRAITS,
  TRAIT_AXES,
  compileTraits,
  hasTraits,
  readTraits,
  type TraitVector,
} from '#shared/kwami/traits'

describe('readTraits', () => {
  it('fills in every axis a Kwami was minted without', () => {
    expect(readTraits({})).toEqual(NEUTRAL_TRAITS)
    expect(readTraits(null)).toEqual(NEUTRAL_TRAITS)
    expect(readTraits(undefined)).toEqual(NEUTRAL_TRAITS)
  })

  it('clamps into range', () => {
    expect(readTraits({ cruelty: 500 }).cruelty).toBe(100)
    expect(readTraits({ cruelty: -500 }).cruelty).toBe(-100)
  })

  it('discards junk per axis rather than falling back wholesale', () => {
    // Unlike the palette, the axes are independent — a Kwami whose warmth
    // survived a corrupted cruelty is still the character its creator built in
    // every respect that parsed.
    const traits = readTraits({ warmth: 40, cruelty: 'very' })
    expect(traits.warmth).toBe(40)
    expect(traits.cruelty).toBe(0)
  })

  it('rounds, so a stored float cannot render as 40.000000001% on the profile', () => {
    expect(readTraits({ warmth: 40.4 }).warmth).toBe(40)
  })
})

describe('hasTraits', () => {
  it('knows a vector nobody moved from one somebody did', () => {
    expect(hasTraits(NEUTRAL_TRAITS)).toBe(false)
    expect(hasTraits({ ...NEUTRAL_TRAITS, cruelty: 1 })).toBe(true)
  })
})

describe('compileTraits', () => {
  it('says nothing at all when nothing was set', () => {
    // Not an empty clause: the prompt is assembled with `.filter(Boolean)`, and
    // a blank line reads to the model as an instruction with no content.
    expect(compileTraits(NEUTRAL_TRAITS)).toBe('')
    expect(compileTraits({})).toBe('')
  })

  it('drops an axis the creator did not really set', () => {
    // A trait at 5 is noise. Passing it as "slightly warm" spends prompt on it
    // and makes every individual slider feel like it does nothing, because all
    // six always appear.
    expect(compileTraits({ ...NEUTRAL_TRAITS, warmth: 5 })).toBe('')
  })

  it('picks the phrasing for the sign', () => {
    expect(compileTraits({ ...NEUTRAL_TRAITS, warmth: 90 })).toContain('warm towards the challenger')
    expect(compileTraits({ ...NEUTRAL_TRAITS, warmth: -90 })).toContain('cold towards the challenger')
  })

  it('scales the adverb with the slider, not the weight', () => {
    // Weight decides ranking; the adverb follows the number the creator set so
    // "70" is "strongly" on every axis. Cruelty's higher weight still puts it
    // first when several axes are set.
    expect(compileTraits({ ...NEUTRAL_TRAITS, cruelty: 70 })).toContain('strongly')
    expect(compileTraits({ ...NEUTRAL_TRAITS, curiosity: 70 })).toContain('strongly')
    expect(compileTraits({ ...NEUTRAL_TRAITS, curiosity: 30 })).toContain('moderately')
    expect(compileTraits({ ...NEUTRAL_TRAITS, curiosity: 15 })).toContain('slightly')
    expect(compileTraits({ ...NEUTRAL_TRAITS, cruelty: 90 })).toContain('very strongly')
  })

  it('keeps at most five directives, strongest first', () => {
    // Six competing adjectives is not a character. The cap is what makes moving
    // one slider decisively actually change how the Kwami sounds.
    const everything: TraitVector = {
      warmth: 100,
      energy: 100,
      confidence: 100,
      patience: 100,
      curiosity: 100,
      cruelty: 100,
    }
    const compiled = compileTraits(everything)
    const adverbs = compiled.match(/very strongly|strongly|moderately|slightly/g) ?? []
    expect(adverbs.length).toBe(5)
    // Cruelty carries the highest weight, so it leads.
    expect(compiled.indexOf('upper hand')).toBeLessThan(compiled.indexOf('quick, animated'))
    // Curiosity is the lightest of the six and is the one dropped.
    expect(compiled).not.toContain('curious about who is talking')
  })

  it('reads a stored blob straight from the database', () => {
    expect(compileTraits({ cruelty: 90, warmth: -80 })).toContain('upper hand')
  })
})

describe('TRAIT_AXES', () => {
  it('covers every field of the vector exactly once', () => {
    const ids = TRAIT_AXES.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(Object.keys(NEUTRAL_TRAITS).sort())
  })

  it('gives every axis both directions and a note for the creator', () => {
    for (const axis of TRAIT_AXES) {
      expect(axis.high.length).toBeGreaterThan(0)
      expect(axis.low.length).toBeGreaterThan(0)
      expect(axis.note.length).toBeGreaterThan(0)
      expect(axis.weight).toBeGreaterThan(0)
    }
  })
})
