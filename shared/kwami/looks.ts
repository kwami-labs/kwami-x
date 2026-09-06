/**
 * Complete visual identities, one click each.
 *
 * The body picker and the palette picker are orthogonal, which is honest and
 * also means a creator has sixty combinations to reason about before they have
 * decided anything else. Most of those sixty are bad — a black hole in pastel
 * glacier reads as a smudge — and nothing on the page says which.
 *
 * These are the combinations worth starting from: a body, a palette and the
 * tuning that makes the pairing work, chosen by looking at the rendered object.
 * Picking one is not a commitment; it writes into exactly the same fields the
 * creator can then move by hand.
 */
import { KWAMI_PALETTES, type KwamiTuning } from './appearance'
import type { KwamiRenderer } from '../types/kwami'

export interface KwamiLook {
  id: string
  label: string
  renderer: KwamiRenderer
  /** An id from `KWAMI_PALETTES`. */
  paletteId: string
  /** Overrides on the body's preset. Absent keys keep the preset's value. */
  tuning: Partial<KwamiTuning>
}

export const KWAMI_LOOKS: KwamiLook[] = [
  {
    id: 'pearl',
    label: 'Pearl',
    renderer: 'blob-xyz',
    paletteId: 'glacier',
    tuning: { amplitude: 0.22, frequency: 1.1, spin: 0.1, rimPower: 3.2 },
  },
  {
    id: 'magma',
    label: 'Magma',
    renderer: 'blob-xyz',
    paletteId: 'ember',
    tuning: { amplitude: 0.52, frequency: 1.8, spin: 0.2, rimPower: 2 },
  },
  {
    id: 'bruise',
    label: 'Bruise',
    renderer: 'blob-xyz',
    paletteId: 'dusk',
    tuning: { amplitude: 0.4, frequency: 0.9, spin: 0.08, reactivity: 1.3 },
  },
  {
    id: 'reliquary',
    label: 'Reliquary',
    renderer: 'crystal-ball',
    paletteId: 'bullion',
    tuning: { amplitude: 0.14, frequency: 3, spin: 0.05, particles: 200 },
  },
  {
    id: 'frostbite',
    label: 'Frostbite',
    renderer: 'crystal-ball',
    paletteId: 'glacier',
    tuning: { amplitude: 0.08, frequency: 4.2, rimPower: 5.4, particles: 90 },
  },
  {
    id: 'swarm',
    label: 'Swarm',
    renderer: 'orbital-shards',
    paletteId: 'venom',
    tuning: { amplitude: 0.48, spin: 0.42, particles: 340 },
  },
  {
    id: 'shrapnel',
    label: 'Shrapnel',
    renderer: 'orbital-shards',
    paletteId: 'ruin',
    tuning: { amplitude: 0.62, frequency: 2.6, spin: 0.5, reactivity: 1.6 },
  },
  {
    id: 'nebula',
    label: 'Nebula',
    renderer: 'stars-genesis',
    paletteId: 'orchid',
    tuning: { amplitude: 0.26, frequency: 0.7, spin: 0.04, particles: 780 },
  },
  {
    id: 'deepfield',
    label: 'Deep field',
    renderer: 'stars-genesis',
    paletteId: 'abyss',
    tuning: { amplitude: 0.16, frequency: 0.6, spin: 0.03, particles: 620 },
  },
  {
    id: 'singularity',
    label: 'Singularity',
    renderer: 'black-hole',
    paletteId: 'ash',
    tuning: { amplitude: 0.06, frequency: 5.2, spin: 0.62, rimPower: 6.6 },
  },
  {
    id: 'nightshade',
    label: 'Nightshade',
    renderer: 'black-hole',
    paletteId: 'signal',
    tuning: { amplitude: 0.1, frequency: 4.6, spin: 0.38, rimPower: 5.2, particles: 420 },
  },
]

export function lookById(id: string | undefined): KwamiLook | undefined {
  return KWAMI_LOOKS.find((l) => l.id === id)
}

/** The palette a look uses, resolved. Falls back to the first rather than throwing. */
export function paletteOfLook(look: KwamiLook) {
  return KWAMI_PALETTES.find((p) => p.id === look.paletteId) ?? KWAMI_PALETTES[0]!
}
