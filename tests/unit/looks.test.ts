import { describe, expect, it } from 'vitest'
import { KWAMI_LOOKS, lookById, paletteOfLook } from '#shared/kwami/looks'
import { KWAMI_PALETTES, TUNING_RANGES, toTuning } from '#shared/kwami/appearance'
import { jitterTraits, randomKwami, randomPalette } from '#shared/kwami/random'
import { KWAMI_PERSONAS } from '#shared/kwami/personas'
import { TRAIT_AXES } from '#shared/kwami/traits'

const RENDERERS = ['blob-xyz', 'crystal-ball', 'orbital-shards', 'stars-genesis', 'black-hole']

describe('KWAMI_LOOKS', () => {
  it('has unique ids', () => {
    const ids = KWAMI_LOOKS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names a real body and a real palette', () => {
    // A look pointing at a palette id that does not exist would silently fall
    // back to Amethyst, so every look with a typo would quietly become the
    // same look.
    for (const look of KWAMI_LOOKS) {
      expect(RENDERERS, look.id).toContain(look.renderer)
      expect(
        KWAMI_PALETTES.map((p) => p.id),
        look.id,
      ).toContain(look.paletteId)
    }
  })

  it('only tunes within the ranges the shader renders in', () => {
    // A look is written by hand, so it is the one place a value outside the
    // slider's own track can be introduced without anyone dragging anything.
    for (const look of KWAMI_LOOKS) {
      for (const [key, value] of Object.entries(look.tuning)) {
        const range = TUNING_RANGES[key as keyof typeof TUNING_RANGES]
        expect(range, `${look.id}.${key}`).toBeDefined()
        expect(value, `${look.id}.${key}`).toBeGreaterThanOrEqual(range.min)
        expect(value, `${look.id}.${key}`).toBeLessThanOrEqual(range.max)
      }
    }
  })

  it('survives the round trip into storage', () => {
    for (const look of KWAMI_LOOKS) {
      expect(toTuning(look.tuning), look.id).toEqual(look.tuning)
    }
  })

  it('covers every body, so no body is unreachable from the looks row', () => {
    expect(new Set(KWAMI_LOOKS.map((l) => l.renderer)).size).toBe(RENDERERS.length)
  })
})

describe('lookById', () => {
  it('finds one, and reports nothing for an id it does not know', () => {
    expect(lookById('magma')?.label).toBe('Magma')
    expect(lookById('nope')).toBeUndefined()
  })
})

describe('paletteOfLook', () => {
  it('resolves the palette a look names', () => {
    expect(paletteOfLook(KWAMI_LOOKS[0]!).id).toBe(KWAMI_LOOKS[0]!.paletteId)
  })
})

/** A deterministic stand-in for `Math.random`, so a roll can be asserted. */
function sequence(values: number[]) {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('randomKwami', () => {
  it('rolls a complete Kwami', () => {
    const kwami = randomKwami(sequence([0.1, 0.4, 0.7, 0.2, 0.9, 0.5]))
    expect(RENDERERS).toContain(kwami.renderer)
    expect(kwami.colorA).toMatch(/^#[0-9a-f]{6}$/i)
    expect(kwami.colorB).toMatch(/^#[0-9a-f]{6}$/i)
    expect(KWAMI_PERSONAS.map((p) => p.id)).toContain(kwami.persona.id)
    expect(Object.keys(kwami.traits).sort()).toEqual(TRAIT_AXES.map((a) => a.id).sort())
  })

  it('takes its colours from the look rather than rolling them separately', () => {
    // The pairing is the part that can go wrong — a black hole in pastel
    // glacier reads as a smudge — which is why the look table exists at all.
    const kwami = randomKwami(sequence([0.5]))
    const palette = paletteOfLook(kwami.look)
    expect(kwami.colorA).toBe(palette.a)
    expect(kwami.colorB).toBe(palette.b)
    expect(kwami.renderer).toBe(kwami.look.renderer)
  })

  it('never rolls off the end of a table', () => {
    // `rng()` returning exactly 1 would index one past the end and hand back
    // `undefined`, which is a strange way to discover a Kwami has no persona.
    for (const value of [0, 0.999999, 1]) {
      const kwami = randomKwami(() => value)
      expect(kwami.look).toBeDefined()
      expect(kwami.persona).toBeDefined()
      expect(kwami.voiceId).toBeTruthy()
      expect(kwami.gameId).toBeTruthy()
    }
  })
})

describe('jitterTraits', () => {
  it('keeps the archetype recognisable', () => {
    // Re-rolling from scratch would produce a card labelled "Grump" attached to
    // a cheerful Kwami. The nudge has to stay small enough that it does not.
    const base = KWAMI_PERSONAS.find((p) => p.id === 'grump')!.traits
    const rolled = jitterTraits(base, () => 1)
    for (const axis of TRAIT_AXES) {
      expect(Math.abs(rolled[axis.id] - base[axis.id]), axis.id).toBeLessThanOrEqual(18)
    }
  })

  it('stays inside the slider range even from an extreme start', () => {
    const extreme = { warmth: 100, energy: 100, confidence: 100, patience: 100, curiosity: 100, cruelty: 100 }
    const rolled = jitterTraits(extreme, () => 1)
    for (const axis of TRAIT_AXES) {
      expect(rolled[axis.id], axis.id).toBeLessThanOrEqual(100)
    }
    const floor = jitterTraits({ ...extreme, cruelty: -100 }, () => 0)
    expect(floor.cruelty).toBeGreaterThanOrEqual(-100)
  })
})

describe('randomPalette', () => {
  it('returns one of the curated pairs, never a generated one', () => {
    // Generated pairs mix to mud across the middle of the sphere; the comment
    // on KWAMI_PALETTES records why they are hand-picked.
    expect(KWAMI_PALETTES).toContain(randomPalette(() => 0.5))
  })
})

describe('paletteOfLook fallback', () => {
  it('still returns a usable palette when a look names one that is gone', () => {
    // A palette can be renamed or retired; a look pointing at the old id must
    // not hand the renderer `undefined` and turn the Kwami white — which is
    // exactly the failure `hslToHex`'s comment records from the other
    // direction.
    const orphan = { ...KWAMI_LOOKS[0]!, paletteId: 'retired-palette' }
    expect(paletteOfLook(orphan)).toBe(KWAMI_PALETTES[0])
  })
})
