import { describe, expect, it } from 'vitest'
import { KWAMI_PERSONAS, personaById } from '#shared/kwami/personas'
import { NEUTRAL_TRAITS, compileTraits, hasTraits } from '#shared/kwami/traits'
import { isHexColor } from '#shared/kwami/appearance'

describe('KWAMI_PERSONAS', () => {
  it('has unique ids', () => {
    const ids = KWAMI_PERSONAS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every archetype a complete card', () => {
    for (const persona of KWAMI_PERSONAS) {
      expect(persona.label.length).toBeGreaterThan(0)
      expect(persona.blurb.length).toBeGreaterThan(0)
      expect(persona.persona.length).toBeGreaterThan(20)
      // The tint is interpolated into a style attribute and a shader-adjacent
      // gradient, so it goes through the same gate as every other colour here.
      expect(isHexColor(persona.accent)).toBe(true)
    }
  })

  it('gives every archetype a trait vector that actually says something', () => {
    // An archetype that compiles to nothing is a card that does nothing when
    // clicked — the creator picks "Grump" and hears the default Kwami.
    for (const persona of KWAMI_PERSONAS) {
      expect(hasTraits(persona.traits)).toBe(true)
      expect(compileTraits(persona.traits)).not.toBe('')
    }
  })

  it('covers every axis of the vector on every archetype', () => {
    for (const persona of KWAMI_PERSONAS) {
      expect(Object.keys(persona.traits).sort()).toEqual(Object.keys(NEUTRAL_TRAITS).sort())
    }
  })

  it('offers characters suited to guarding something', () => {
    // The list would be useless if every archetype were warm and helpful: a
    // Kwami exists to stop someone taking its pot. At least half should be
    // willing to use the advantage.
    const cold = KWAMI_PERSONAS.filter((p) => p.traits.cruelty > 0)
    expect(cold.length).toBeGreaterThanOrEqual(KWAMI_PERSONAS.length / 2)
  })
})

describe('personaById', () => {
  it('finds one by id', () => {
    expect(personaById('grump')?.label).toBe('Grump')
  })

  it('returns nothing for an id it does not know, rather than a default', () => {
    // Unlike voices and games, there is no fallback archetype: a Kwami with no
    // persona is a valid Kwami, and inventing one for it would overwrite a
    // creator's deliberate blank.
    expect(personaById('nonexistent')).toBeUndefined()
    expect(personaById(undefined)).toBeUndefined()
  })
})
