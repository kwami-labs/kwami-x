/**
 * Complete visual identities, one click each.
 *
 * The body picker and the palette picker are orthogonal, which is honest and
 * also means a creator has sixty combinations to reason about before they have
 * decided anything else. Most of those sixty are bad — a black hole in pastel
 * glacier reads as a smudge — and nothing on the page says which.
 *
 * These are the combinations worth starting from: a body, a skin, a palette and
 * the tuning that makes the pairing work, chosen by looking at the rendered
 * object. Picking one is not a commitment; it writes into exactly the same
 * fields the creator can then move by hand.
 *
 * Adding the skin axis multiplied the space by twenty-two, which makes this
 * table more necessary rather than less: `chrome` on a black hole is one of the
 * best things this renderer does, and nothing on a grid of twenty-two swatches
 * would ever have told anyone to try it.
 */
import { KWAMI_PALETTES, type KwamiTuning } from './appearance'
import type { KwamiSkin } from './skins'
import type { KwamiRenderer } from '../types/kwami'

export interface KwamiLook {
  id: string
  label: string
  renderer: KwamiRenderer
  /** The surface. What the body is made of, as opposed to how it moves. */
  skin: KwamiSkin
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
    skin: 'iridescent',
    paletteId: 'glacier',
    tuning: { amplitude: 0.16, frequency: 0.7, spin: 0.1, rimPower: 3.2, shininess: 110 },
  },
  {
    id: 'magma',
    label: 'Magma',
    renderer: 'blob-xyz',
    skin: 'plasma',
    paletteId: 'ember',
    tuning: { amplitude: 0.3, frequency: 1.2, spin: 0.2, rimPower: 2, lightIntensity: 0.9 },
  },
  {
    id: 'bruise',
    label: 'Bruise',
    renderer: 'blob-xyz',
    skin: 'subsurface',
    paletteId: 'dusk',
    tuning: { amplitude: 0.26, frequency: 0.65, spin: 0.08, reactivity: 2.2, opacity: 0.92 },
  },
  {
    id: 'mercury',
    label: 'Mercury',
    renderer: 'blob-xyz',
    skin: 'chrome',
    paletteId: 'ash',
    tuning: { amplitude: 0.2, frequency: 0.8, spin: 0.12, shininess: 180 },
  },
  {
    id: 'porcelain',
    label: 'Porcelain',
    renderer: 'blob-xyz',
    skin: 'glossy',
    paletteId: 'orchid',
    tuning: { amplitude: 0.14, frequency: 0.55, spin: 0.09, shininess: 150, breathing: 0.05 },
  },
  {
    id: 'lantern',
    label: 'Lantern',
    renderer: 'blob-xyz',
    skin: 'jade',
    paletteId: 'moss',
    tuning: { amplitude: 0.18, frequency: 0.9, spin: 0.07, shininess: 80, lightIntensity: 0.4 },
  },
  {
    id: 'reliquary',
    label: 'Reliquary',
    renderer: 'crystal-ball',
    skin: 'marble',
    paletteId: 'bullion',
    tuning: { amplitude: 0.1, frequency: 2.2, spin: 0.05, particles: 200 },
  },
  {
    id: 'frostbite',
    label: 'Frostbite',
    renderer: 'crystal-ball',
    skin: 'fresnel',
    paletteId: 'glacier',
    tuning: { amplitude: 0.06, frequency: 3, rimPower: 5.4, particles: 90, opacity: 0.85 },
  },
  {
    id: 'seance',
    label: 'Séance',
    renderer: 'crystal-ball',
    skin: 'hologram',
    paletteId: 'signal',
    tuning: { amplitude: 0.09, frequency: 2.4, spin: 0.14, particles: 160, opacity: 0.8 },
  },
  {
    id: 'swarm',
    label: 'Swarm',
    renderer: 'orbital-shards',
    skin: 'metallic',
    paletteId: 'venom',
    tuning: { amplitude: 0.4, spin: 0.42, particles: 340, shininess: 140 },
  },
  {
    id: 'shrapnel',
    label: 'Shrapnel',
    renderer: 'orbital-shards',
    skin: 'stepped',
    paletteId: 'ruin',
    tuning: { amplitude: 0.55, frequency: 2.6, spin: 0.5, reactivity: 2.6 },
  },
  {
    id: 'woodcut',
    label: 'Woodcut',
    renderer: 'orbital-shards',
    skin: 'halftone',
    paletteId: 'ash',
    tuning: { amplitude: 0.34, frequency: 1.6, spin: 0.24, particles: 0 },
  },
  {
    id: 'nebula',
    label: 'Nebula',
    renderer: 'stars-genesis',
    skin: 'iridescent',
    paletteId: 'orchid',
    tuning: { amplitude: 0.2, frequency: 0.5, spin: 0.04, particles: 780, lightIntensity: 0.8 },
  },
  {
    id: 'deepfield',
    label: 'Deep field',
    renderer: 'stars-genesis',
    skin: 'radial',
    paletteId: 'abyss',
    tuning: { amplitude: 0.12, frequency: 0.4, spin: 0.03, particles: 620 },
  },
  {
    id: 'kiln',
    label: 'Kiln',
    renderer: 'stars-genesis',
    skin: 'clay',
    paletteId: 'ember',
    tuning: { amplitude: 0.16, frequency: 0.7, spin: 0.05, particles: 300, shininess: 25 },
  },
  {
    id: 'singularity',
    label: 'Singularity',
    renderer: 'black-hole',
    skin: 'chrome',
    paletteId: 'ash',
    tuning: { amplitude: 0.04, frequency: 3.8, spin: 0.62, rimPower: 6.6, shininess: 190 },
  },
  {
    id: 'nightshade',
    label: 'Nightshade',
    renderer: 'black-hole',
    skin: 'hologram',
    paletteId: 'signal',
    tuning: { amplitude: 0.08, frequency: 3.4, spin: 0.38, rimPower: 5.2, particles: 420 },
  },
  {
    id: 'inkwell',
    label: 'Inkwell',
    renderer: 'black-hole',
    skin: 'outlined',
    paletteId: 'dusk',
    tuning: { amplitude: 0.06, frequency: 4, spin: 0.44, rimPower: 5.8, particles: 120 },
  },
]

export function lookById(id: string | undefined): KwamiLook | undefined {
  return KWAMI_LOOKS.find((l) => l.id === id)
}

/** The palette a look uses, resolved. Falls back to the first rather than throwing. */
export function paletteOfLook(look: KwamiLook) {
  return KWAMI_PALETTES.find((p) => p.id === look.paletteId) ?? KWAMI_PALETTES[0]!
}
