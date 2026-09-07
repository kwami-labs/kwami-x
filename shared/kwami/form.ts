/**
 * The studio's appearance state, and every transition it can make.
 *
 * Everything the "Form" tab does to a Kwami's look lives here rather than in
 * the component, for two reasons. The transitions are not trivial — picking a
 * look sets six fields, picking a skin moves two sliders, moving any slider
 * clears the look badge — and the same transitions have to happen identically
 * on the mint page and on the owner's edit screen. A second hand-written copy
 * of "what a click on a swatch means" is a second place for the two screens to
 * disagree about what the creator just chose.
 *
 * Every function is pure and returns a patch rather than mutating, so the
 * caller decides when the change lands and a test can ask what a click does
 * without mounting anything.
 */
import { KWAMI_PALETTES, type KwamiTuning, type Palette, TUNING_RANGES } from './appearance'
import { KWAMI_LOOKS, paletteOfLook } from './looks'
import { harmonyById } from './harmony'
import { DEFAULT_SKIN, isSkin, tuningForSkin, type KwamiSkin } from './skins'
import type { Rng } from './random'
import type { KwamiRenderer } from '../types/kwami'

export interface KwamiFormState {
  renderer: KwamiRenderer
  skin: KwamiSkin
  colorA: string
  colorB: string
  colorC: string
  /** The named palette in use, or null once the creator picks colours by hand. */
  paletteId: string | null
  /** The look in use, or null once any part of it has been moved. */
  lookId: string | null
  /** The harmony last rolled, kept so the button can re-roll the same relationship. */
  harmonyId: string | null
  tuning: Partial<KwamiTuning>
}

/** A patch to merge into the state. Absent keys are left alone. */
export type FormPatch = Partial<KwamiFormState>

/**
 * A whole visual identity at once — body, skin, palette and the tuning that
 * suits the combination.
 */
export function applyLook(id: string): FormPatch {
  const look = KWAMI_LOOKS.find((l) => l.id === id)
  if (!look) return {}
  const palette = paletteOfLook(look)
  return {
    lookId: look.id,
    renderer: look.renderer,
    skin: look.skin,
    paletteId: palette.id,
    harmonyId: null,
    colorA: palette.a,
    colorB: palette.b,
    colorC: palette.c,
    // The look's own tuning sits on top of the skin's material defaults, so a
    // look that says nothing about shininess still gets its skin's.
    tuning: { ...tuningForSkin(look.skin), ...look.tuning },
  }
}

export function applyPalette(id: string): FormPatch {
  const palette = KWAMI_PALETTES.find((p) => p.id === id)
  if (!palette) return {}
  return {
    paletteId: palette.id,
    harmonyId: null,
    lookId: null,
    colorA: palette.a,
    colorB: palette.b,
    colorC: palette.c,
  }
}

/** Roll three colours that hold together, by the named relationship. */
export function applyHarmony(id: string, rng: Rng): FormPatch {
  const harmony = harmonyById(id)
  const palette: Palette = harmony.generate(rng)
  return {
    harmonyId: harmony.id,
    paletteId: null,
    lookId: null,
    colorA: palette.a,
    colorB: palette.b,
    colorC: palette.c,
  }
}

/**
 * Change the surface.
 *
 * The material defaults are written into the tuning rather than left implicit,
 * because the creator can then see and move them — a skin that silently set a
 * shininess the "Surface" panel showed as untouched would be lying about what
 * is driving the Kwami.
 */
export function applySkin(state: KwamiFormState, skin: string): FormPatch {
  if (!isSkin(skin)) return {}
  return {
    skin,
    lookId: null,
    tuning: { ...state.tuning, ...tuningForSkin(skin) },
  }
}

/** Change the body. Keeps the creator's overrides — see `resolveRendererParams`. */
export function applyRenderer(renderer: KwamiRenderer): FormPatch {
  return { renderer, lookId: null }
}

/**
 * Move one slider.
 *
 * Clamped here rather than trusted from the input, because a `<input
 * type="range">` is not the only thing that reaches this — a restored draft
 * from an older build carries values from ranges that have since moved.
 */
export function setTuning(state: KwamiFormState, key: keyof KwamiTuning, value: number): FormPatch {
  const range = TUNING_RANGES[key]
  if (!range || !Number.isFinite(value)) return {}
  const clamped = Math.max(range.min, Math.min(range.max, value))
  // The look described a specific combination; once a slider moves it is no
  // longer that combination, and leaving the card highlighted would say it is.
  return { tuning: { ...state.tuning, [key]: clamped }, lookId: null }
}

/** Drop one override, back to whatever the body's preset says today. */
export function clearTuningKey(state: KwamiFormState, key: keyof KwamiTuning): FormPatch {
  // Rebuilt without the key rather than deleted from a copy: the stored tuning
  // is a record of what the creator actually moved, and an `undefined` left
  // behind reads as "tuned, to nothing" everywhere downstream.
  const next = Object.fromEntries(
    Object.entries(state.tuning).filter(([name]) => name !== key),
  ) as Partial<KwamiTuning>
  return { tuning: next, lookId: null }
}

export function clearTuning(): FormPatch {
  return { tuning: {}, lookId: null }
}

/** Set all three axes of an XYZ row at once — the link toggle. */
export function linkAxes(state: KwamiFormState, keys: Array<keyof KwamiTuning>, value: number): FormPatch {
  let patch: Partial<KwamiTuning> = { ...state.tuning }
  for (const key of keys) {
    const range = TUNING_RANGES[key]
    if (!range) continue
    patch = { ...patch, [key]: Math.max(range.min, Math.min(range.max, value)) }
  }
  return { tuning: patch, lookId: null }
}

function rollIn(key: keyof KwamiTuning, rng: Rng): number {
  const { min, max, step } = TUNING_RANGES[key]
  const raw = min + rng() * (max - min)
  return Math.round(raw / step) * step
}

/**
 * Roll one section of the panel.
 *
 * Per-section rather than one dice for everything, because the sections are
 * how a creator actually works: someone who has spent five minutes on a
 * palette and wants a different silhouette is not asking to lose the palette.
 * The desktop app made the same split for the same reason.
 */
export function randomizeGroup(state: KwamiFormState, keys: Array<keyof KwamiTuning>, rng: Rng): FormPatch {
  const next: Partial<KwamiTuning> = { ...state.tuning }
  for (const key of keys) {
    // Resolution is subdivision, not taste — a roll that dropped a Kwami to a
    // visibly faceted mesh reads as the dice having broken something.
    if (key === 'resolution') continue
    next[key] = rollIn(key, rng)
  }
  return { tuning: next, lookId: null }
}

/** A fresh state, before anything has been chosen. */
export function initialFormState(): KwamiFormState {
  const palette = KWAMI_PALETTES[0]!
  return {
    renderer: 'blob-xyz',
    skin: DEFAULT_SKIN,
    colorA: palette.a,
    colorB: palette.b,
    colorC: palette.c,
    paletteId: palette.id,
    lookId: null,
    harmonyId: null,
    tuning: {},
  }
}
