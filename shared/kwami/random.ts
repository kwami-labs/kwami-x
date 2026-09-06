/**
 * Roll a whole Kwami.
 *
 * The mint form opens empty, and an empty form is the hardest possible thing to
 * react to: a creator has to invent a character, a look, a voice and a contest
 * before they have seen a single one of those choices do anything. A dice gives
 * them something complete and specific to disagree with, which is a far easier
 * starting position than a blank field — and `suggestPalette` already
 * establishes that this page should open on something rather than on grey.
 *
 * The random source is injected rather than read from `Math.random`, because
 * nothing in `shared/` reads a clock or an ambient source: a deterministic
 * `rng` is what makes this testable at all, and the caller passing
 * `Math.random` is a one-word decision made at the edge.
 */
import { KWAMI_PALETTES } from './appearance'
import { KWAMI_LOOKS, paletteOfLook, type KwamiLook } from './looks'
import { KWAMI_PERSONAS, type KwamiPersona } from './personas'
import { KWAMI_GAMES, KWAMI_VOICES } from './voice'
import { TRAIT_AXES, type TraitVector } from './traits'
import type { KwamiRenderer } from '../types/kwami'

/** A source of numbers in [0, 1). `Math.random` satisfies it. */
export type Rng = () => number

function pick<T>(list: readonly T[], rng: Rng): T {
  return list[Math.floor(rng() * list.length) % list.length]!
}

/**
 * Jitter a trait vector without losing the character it came from.
 *
 * ±18 rather than a fresh random vector: an archetype's numbers are what make
 * it that archetype, and re-rolling them from scratch would produce a card
 * labelled "Grump" attached to a cheerful Kwami. This nudges, so two rolls of
 * the same archetype differ without either stopping being it.
 */
export function jitterTraits(traits: TraitVector, rng: Rng, spread = 18): TraitVector {
  const out = { ...traits }
  for (const axis of TRAIT_AXES) {
    const delta = Math.round((rng() * 2 - 1) * spread)
    out[axis.id] = Math.max(-100, Math.min(100, out[axis.id] + delta))
  }
  return out
}

export interface RandomKwami {
  look: KwamiLook
  renderer: KwamiRenderer
  colorA: string
  colorB: string
  paletteId: string
  persona: KwamiPersona
  traits: TraitVector
  voiceId: string
  gameId: string
}

/**
 * A complete, coherent Kwami.
 *
 * Coherent is the point. Rolling each field independently would mostly produce
 * combinations nobody would ship — the look comes from the curated table rather
 * than from a body and a palette drawn separately, for the same reason
 * `KWAMI_PALETTES` is hand-picked rather than generated: the pairing is the
 * part that can go wrong.
 */
export function randomKwami(rng: Rng): RandomKwami {
  const look = pick(KWAMI_LOOKS, rng)
  const palette = paletteOfLook(look)
  const persona = pick(KWAMI_PERSONAS, rng)

  return {
    look,
    renderer: look.renderer,
    colorA: palette.a,
    colorB: palette.b,
    paletteId: palette.id,
    persona,
    traits: jitterTraits(persona.traits, rng),
    voiceId: pick(KWAMI_VOICES, rng).id,
    gameId: pick(KWAMI_GAMES, rng).id,
  }
}

/** Just the colours, for the palette shuffle beside the swatches. */
export function randomPalette(rng: Rng) {
  return pick(KWAMI_PALETTES, rng)
}
