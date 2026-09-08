/**
 * Colour harmonies, for creators who want a palette rather than a colour.
 *
 * `KWAMI_PALETTES` is twelve hand-picked triples, which is the right answer for
 * someone who wants to be finished in one click and the wrong one for someone
 * who wants *their* colour. Three raw colour inputs are the opposite trade: a
 * complete answer to "what colour", and no help at all with the part that
 * actually goes wrong, which is that three colours picked independently mix to
 * mud across the middle of a sphere.
 *
 * These sit between the two. The creator picks a relationship — complementary,
 * triadic, sunset — and gets three colours that hold together by construction,
 * as many times as they like until one is theirs.
 *
 * The generators take an `rng` rather than reading `Math.random`, for the same
 * reason `random.ts` does: nothing in `shared/` reads an ambient source, and a
 * seeded generator is what makes "does `warm` actually produce warm hues"
 * something a test can ask.
 */
import { hslToHex, type Palette } from './appearance'
import type { Rng } from './random'

export type HarmonyId =
  | 'complementary'
  | 'analogous'
  | 'triadic'
  | 'split'
  | 'monochrome'
  | 'warm'
  | 'cool'
  | 'pastel'
  | 'vibrant'
  | 'sunset'
  | 'ocean'
  | 'forest'

export interface Harmony {
  id: HarmonyId
  label: string
  /** One line. What the relationship does, not what it is called. */
  note: string
  generate: (rng: Rng) => Palette
}

export const KWAMI_HARMONIES: Harmony[] = [
  {
    id: 'complementary',
    label: 'Complementary',
    note: 'Opposites. Maximum separation between core and rim.',
    generate: (rng) => {
      const h = rng() * 360
      const s = 0.6 + rng() * 0.3
      const l = 0.45 + rng() * 0.2
      return {
        a: hslToHex(h, s, l),
        b: hslToHex(h + 180, s, l),
        c: hslToHex(h + 180, s * 0.7, Math.min(0.85, l + 0.15)),
      }
    },
  },
  {
    id: 'analogous',
    label: 'Analogous',
    note: 'Neighbours. Reads as one colour with depth.',
    generate: (rng) => {
      const h = rng() * 360
      const s = 0.55 + rng() * 0.35
      const l = 0.45 + rng() * 0.2
      return {
        a: hslToHex(h, s, l),
        b: hslToHex(h + 30, s, Math.min(0.9, l + 0.05)),
        c: hslToHex(h - 30, s, Math.max(0.1, l - 0.05)),
      }
    },
  },
  {
    id: 'triadic',
    label: 'Triadic',
    note: 'Three-way. The most colour a Kwami can carry and stay legible.',
    generate: (rng) => {
      const h = rng() * 360
      const s = 0.6 + rng() * 0.3
      const l = 0.5 + rng() * 0.15
      return { a: hslToHex(h, s, l), b: hslToHex(h + 120, s, l), c: hslToHex(h + 240, s, l) }
    },
  },
  {
    id: 'split',
    label: 'Split',
    note: 'A complement, softened. Contrast without the clash.',
    generate: (rng) => {
      const h = rng() * 360
      const s = 0.6 + rng() * 0.3
      const l = 0.5 + rng() * 0.15
      return { a: hslToHex(h, s, l), b: hslToHex(h + 150, s, l), c: hslToHex(h + 210, s, l) }
    },
  },
  {
    id: 'monochrome',
    label: 'Mono',
    note: 'One hue, three weights. Lets the shape do the talking.',
    generate: (rng) => {
      const h = rng() * 360
      const s = 0.5 + rng() * 0.4
      return {
        a: hslToHex(h, s, 0.3 + rng() * 0.15),
        b: hslToHex(h, s * 0.8, 0.5 + rng() * 0.1),
        c: hslToHex(h, s * 0.6, 0.7 + rng() * 0.1),
      }
    },
  },
  {
    id: 'warm',
    label: 'Warm',
    note: 'Reds through yellows. Reads as lit from inside.',
    generate: (rng) => {
      const h = rng() * 60
      const s = 0.65 + rng() * 0.3
      const l = 0.5 + rng() * 0.15
      return {
        a: hslToHex(h, s, l),
        b: hslToHex(h + 20 + rng() * 20, s, Math.min(0.9, l + 0.05)),
        c: hslToHex(h - 10 + rng() * 10, s * 0.9, Math.max(0.1, l - 0.05)),
      }
    },
  },
  {
    id: 'cool',
    label: 'Cool',
    note: 'Cyans through violets. Distant and unbothered.',
    generate: (rng) => {
      const h = 180 + rng() * 80
      const s = 0.55 + rng() * 0.35
      const l = 0.45 + rng() * 0.2
      return {
        a: hslToHex(h, s, l),
        b: hslToHex(h + 25, s, Math.min(0.9, l + 0.08)),
        c: hslToHex(h - 25, s * 0.9, Math.max(0.1, l - 0.06)),
      }
    },
  },
  {
    id: 'pastel',
    label: 'Pastel',
    note: 'Low saturation, high light. Soft against a dark page.',
    generate: (rng) => {
      const h = rng() * 360
      return {
        a: hslToHex(h, 0.45, 0.78),
        b: hslToHex(h + 60, 0.4, 0.82),
        c: hslToHex(h + 300, 0.42, 0.74),
      }
    },
  },
  {
    id: 'vibrant',
    label: 'Vibrant',
    note: 'Everything pushed to the edge. Loud on purpose.',
    generate: (rng) => {
      const h = rng() * 360
      return {
        a: hslToHex(h, 0.95, 0.55),
        b: hslToHex(h + 140, 0.92, 0.52),
        c: hslToHex(h + 250, 0.9, 0.58),
      }
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    note: 'Orange to violet, the way the sky actually does it.',
    generate: (rng) => {
      const h = 12 + rng() * 26
      return {
        a: hslToHex(h, 0.9, 0.58),
        b: hslToHex(h + 28, 0.86, 0.66),
        c: hslToHex(h + 250, 0.6, 0.42),
      }
    },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    note: 'Deep blue to shallow green. Cold and heavy.',
    generate: (rng) => {
      const h = 185 + rng() * 30
      return {
        a: hslToHex(h, 0.72, 0.45),
        b: hslToHex(h - 30, 0.68, 0.62),
        c: hslToHex(h + 35, 0.6, 0.28),
      }
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    note: 'Greens with an earth note underneath.',
    generate: (rng) => {
      const h = 95 + rng() * 35
      return {
        a: hslToHex(h, 0.55, 0.4),
        b: hslToHex(h + 25, 0.6, 0.56),
        c: hslToHex(h - 60, 0.45, 0.3),
      }
    },
  },
]

/** A harmony by id, falling back to the first rather than throwing. */
export function harmonyById(id: string | null | undefined): Harmony {
  return KWAMI_HARMONIES.find((h) => h.id === id) ?? KWAMI_HARMONIES[0]!
}
