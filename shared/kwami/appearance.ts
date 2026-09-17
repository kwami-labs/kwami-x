/**
 * What a Kwami looks like.
 *
 * A Kwami's colours reach six surfaces — the arena card, its profile, the play
 * stage, an embed on a stranger's site, the NFT thumbnail an explorer renders,
 * and the mint preview the creator designed it in. If the derivation lives in
 * more than one of them it will drift, and drift here means the object someone
 * minted is not the object they were shown. It lives here, once.
 *
 * Two sources, in order:
 *
 *  1. The palette the creator chose, stored in `kwamis.appearance` at draft.
 *  2. A hash of the mint address, for Kwamis minted before this existed.
 *
 * The hash fallback is the reason (2) is not simply "grey": a mint address is
 * random, so hashing it gives every Kwami a stable, distinct look for free. It
 * is a decent default and a poor design, which is exactly why the creator gets
 * to override it.
 */

import { DEFAULT_SKIN, isSkin, type KwamiSkin } from './skins'

export interface KwamiAppearance {
  /** Core colour, `#rrggbb`. */
  colorA: string
  /** Rim and displacement-peak colour, `#rrggbb`. */
  colorB: string
  /**
   * Third colour, `#rrggbb`. Optional.
   *
   * The skins are tricolour — `radial` sweeps all three around the body,
   * `marble` veins them together — and a Kwami minted before skins existed has
   * only two. Rather than render those as a degenerate pair, `thirdColor`
   * derives the missing one from the other two, so an old Kwami gains a
   * coherent third rather than a grey one.
   */
  colorC?: string
  /** Surface material. Absent means `DEFAULT_SKIN`. */
  skin?: KwamiSkin
}

export interface Palette {
  a: string
  b: string
  c: string
}

/** A named palette offered in the builder. */
export interface NamedPalette extends Palette {
  id: string
  label: string
}

/**
 * The curated palettes.
 *
 * Hand-picked rather than generated: the shader mixes A into B across the
 * displaced surface and lights the rim with B, so a pair that looks fine as two
 * swatches can mix to mud across the middle of the sphere. Every pair here was
 * chosen by looking at the rendered object, and each holds its contrast against
 * the near-black background the app is built on.
 */
export const KWAMI_PALETTES: NamedPalette[] = [
  { id: 'amethyst', label: 'Amethyst', a: '#7c5cff', b: '#3ddc97', c: '#ff5cb8' },
  { id: 'ember', label: 'Ember', a: '#ff7a45', b: '#ffd166', c: '#ff2d55' },
  { id: 'abyss', label: 'Abyss', a: '#1f6feb', b: '#7ee7ff', c: '#3d2bff' },
  { id: 'venom', label: 'Venom', a: '#39e08c', b: '#c8ff5e', c: '#00b3a4' },
  { id: 'orchid', label: 'Orchid', a: '#ff5cb8', b: '#a77bff', c: '#ffb3d9' },
  { id: 'bullion', label: 'Bullion', a: '#f5c451', b: '#ff9d3d', c: '#fff3c4' },
  { id: 'glacier', label: 'Glacier', a: '#7ee7ff', b: '#e6f1ff', c: '#4f8fd6' },
  { id: 'ruin', label: 'Ruin', a: '#ff5c72', b: '#ff9d3d', c: '#8c1f3d' },
  { id: 'moss', label: 'Moss', a: '#4fb286', b: '#d8f36b', c: '#1f5f4a' },
  { id: 'signal', label: 'Signal', a: '#00d4ff', b: '#ff2bd1', c: '#7a5cff' },
  { id: 'dusk', label: 'Dusk', a: '#5d5fef', b: '#ff8fab', c: '#2a1f5c' },
  { id: 'ash', label: 'Ash', a: '#8b93a7', b: '#dfe4ef', c: '#4a5265' },
]

/** Six-digit hex only — the shader and the SVG both interpolate these directly. */
const HEX = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

/**
 * HSL to `#rrggbb`.
 *
 * The derived palette has to come out as hex, not as an `hsl()` string.
 * `THREE.Color.setStyle` matches a comma-separated regex, so CSS Color 4's
 * `hsl(200 78% 62%)` — valid CSS, and what this used to emit — falls through
 * and leaves the colour at its default WHITE. Every Kwami avatar rendered white,
 * in the app and in every third-party embed, while the CSS gradients built from
 * the same string looked perfectly correct.
 *
 * The comma form `hsl(200, 78%, 62%)` fixes that, but hex is better still: it is
 * the one notation the shader, the SVG thumbnail, the stylesheet and a
 * creator-picked `<input type="color">` all read identically, so there is no
 * second syntax for anyone to reintroduce the bug through.
 *
 * `tests/unit/palette.test.ts` asserts the round trip through an actual
 * THREE.Color rather than the shape of the string, because asserting the shape
 * is exactly what failed to catch this the first time.
 */
export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - chroma / 2
  const [r, g, b] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x]
  const channel = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r!)}${channel(g!)}${channel(b!)}`
}

/**
 * A stable colour pair derived from a Kwami's mint.
 *
 * 140° apart rather than a true complement: exact opposites on the wheel give
 * one bright colour and one that goes muddy against a dark background, and the
 * rim light would disappear on half the Kwamis minted.
 */
export function paletteFromMint(mint: string): Palette {
  let hash = 0
  for (let i = 0; i < mint.length; i++) hash = (hash * 31 + mint.charCodeAt(i)) >>> 0
  const hueA = hash % 360
  return {
    a: hslToHex(hueA, 0.78, 0.62),
    b: hslToHex(hueA + 140, 0.72, 0.58),
    c: hslToHex(hueA + 250, 0.7, 0.5),
  }
}

/** `#rrggbb` back to HSL, with hue in degrees and the rest in [0, 1]. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  return { h: (h + 360) % 360, s, l }
}

/**
 * The third colour for a palette that only has two.
 *
 * Every Kwami minted before the tricolour skins existed stored `colorA` and
 * `colorB` and nothing else, and half the catalogue reads three. Falling back
 * to grey there would put a dead band through the middle of `radial` on every
 * one of them, so the third is derived instead: A's hue rotated past B's, at
 * B's weight. Deterministic, so the same old Kwami renders identically
 * everywhere, and close enough to the pairing the creator actually chose that
 * it reads as theirs.
 */
export function thirdColor(a: string, b: string): string {
  const ha = hexToHsl(a)
  const hb = hexToHsl(b)
  return hslToHex(ha.h + 250, Math.max(0.35, (ha.s + hb.s) / 2), Math.min(0.72, hb.l + 0.08))
}

/**
 * The palette to actually render a Kwami with.
 *
 * Takes the whole row rather than the colours, so every call site gets the
 * fallback without having to remember it exists. An `appearance` blob with a
 * malformed colour falls all the way back rather than half-applying: one valid
 * colour and one default produces a pairing nobody chose.
 */
export function paletteFor(kwami: {
  mint?: string | null
  appearance?: Record<string, unknown> | null
}): Palette {
  const a = kwami.appearance?.colorA
  const b = kwami.appearance?.colorB
  const c = kwami.appearance?.colorC
  if (isHexColor(a) && isHexColor(b)) return { a, b, c: isHexColor(c) ? c : thirdColor(a, b) }
  return paletteFromMint(kwami.mint ?? '')
}

/**
 * The skin a Kwami wears, as stored.
 *
 * Separate from `paletteFor` because it degrades separately: an unknown skin id
 * — a Kwami minted by a newer build, or a hand-edited row — is a surface this
 * build cannot compile, and the right answer is the default surface with the
 * creator's real colours on it, not a fallback palette as well.
 */
export function skinFor(kwami: { appearance?: Record<string, unknown> | null }): KwamiSkin {
  const skin = kwami.appearance?.skin
  return isSkin(skin) ? skin : DEFAULT_SKIN
}

/**
 * Normalise a chosen appearance for storage. Returns `{}` when it is not usable.
 *
 * The palette is all-or-nothing and the tuning is not; see `readTuning` for why
 * the two are treated differently.
 */
export function toAppearance(
  palette: Partial<Palette>,
  tuning?: Partial<KwamiTuning> | null,
  skin?: string | null,
): Record<string, unknown> {
  if (!isHexColor(palette.a) || !isHexColor(palette.b)) return {}
  const cleaned = toTuning(tuning)
  const out: Record<string, unknown> = { colorA: palette.a, colorB: palette.b }
  // Written only when it is a real third choice. A derived colour stored as if
  // it were chosen would freeze that Kwami on today's derivation, which is the
  // same mistake `toTuning` avoids by storing overrides rather than a snapshot.
  if (isHexColor(palette.c) && palette.c !== thirdColor(palette.a, palette.b)) out.colorC = palette.c
  if (isSkin(skin) && skin !== DEFAULT_SKIN) out.skin = skin
  if (cleaned) out.tuning = cleaned
  return out
}

/**
 * A palette nobody has to pick.
 *
 * The builder opens on a Kwami that already looks good, because a first screen
 * showing a default grey blob asks the creator to do design work before they
 * have decided whether they want a Kwami at all. Seeded off the name so two
 * people typing different names do not both land on the same one.
 */
export function suggestPalette(seed: string): NamedPalette {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return KWAMI_PALETTES[hash % KWAMI_PALETTES.length]!
}

/**
 * Renderer tuning, on top of the body's preset.
 *
 * The five bodies are parameter sets over one shader, not five pipelines — so
 * the parameters were always the real design space and the five names were only
 * ever five good points inside it. This exposes the space itself: a creator
 * picks the body that is closest and then moves it.
 *
 * Every field is optional, and an absent field means "whatever the preset
 * says". Storing only the overrides rather than a full snapshot matters,
 * because a Kwami minted today should still benefit if a preset is ever
 * retuned — a stored copy of the defaults would freeze that Kwami on the old
 * numbers forever, which is not what anyone chose.
 *
 * Lives in `appearance`, which is already `jsonb` and already untyped, so none
 * of this needs a migration.
 */
export interface KwamiTuning {
  /** Base displacement amplitude — how far the surface travels at rest. */
  amplitude: number
  /** Base noise frequency. Low reads as a liquid swell, high as a sea urchin. */
  frequency: number
  /** How hard audio pushes the surface. */
  reactivity: number
  /** Rotation speed, radians per second. */
  spin: number
  /** Rim light power; higher is a tighter, brighter edge. */
  rimPower: number
  /** Sparks orbiting the core. */
  particles: number

  /**
   * Per-axis frequency, as a multiplier on `frequency`.
   *
   * The three together are what makes a blob a *creature* rather than a noisy
   * ball: equal values give an even, uninteresting boil, and pulling one axis
   * down stretches the features into ridges that run around the body. This is
   * the single most expressive control on the page, which is why it is three
   * sliders and a link toggle rather than one number.
   */
  spikeX: number
  spikeY: number
  spikeZ: number

  /** Per-axis displacement weight, as a multiplier on `amplitude`. */
  ampX: number
  ampY: number
  ampZ: number

  /** Per-axis animation speed. Unequal values make the motion read as a drift. */
  timeX: number
  timeY: number
  timeZ: number

  /** Idle swell when nothing is speaking. The Kwami is never completely still. */
  breathing: number

  /** Specular power, 0–200. Each skin reads it on its own curve. */
  shininess: number
  /** Surface opacity. Below 1 the Kwami renders with depth writes off. */
  opacity: number
  /** Emissive lift — the Kwami glows from inside rather than only catching light. */
  lightIntensity: number
  /** Geometry subdivision. Higher is smoother and more expensive. */
  resolution: number
}

/**
 * The bounds each tunable is clamped into.
 *
 * These are not taste. Each one is the range in which the shader still produces
 * a Kwami: amplitude past 1 turns the sphere inside out through its own centre,
 * a frequency under 0.1 stops reading as a surface at all, and particle counts
 * in the thousands cost more frame budget than the mesh does. A creator can
 * make something ugly inside these bounds — that is their business — but not
 * something broken.
 */
export const TUNING_RANGES: Record<keyof KwamiTuning, { min: number; max: number; step: number }> = {
  amplitude: { min: 0, max: 1, step: 0.01 },
  frequency: { min: 0.1, max: 6, step: 0.05 },
  reactivity: { min: 0, max: 3, step: 0.05 },
  spin: { min: 0, max: 0.8, step: 0.01 },
  rimPower: { min: 1, max: 8, step: 0.1 },
  particles: { min: 0, max: 900, step: 10 },
  spikeX: { min: 0.05, max: 4, step: 0.05 },
  spikeY: { min: 0.05, max: 4, step: 0.05 },
  spikeZ: { min: 0.05, max: 4, step: 0.05 },
  ampX: { min: 0, max: 2, step: 0.05 },
  ampY: { min: 0, max: 2, step: 0.05 },
  ampZ: { min: 0, max: 2, step: 0.05 },
  timeX: { min: 0, max: 3, step: 0.05 },
  timeY: { min: 0, max: 3, step: 0.05 },
  timeZ: { min: 0, max: 3, step: 0.05 },
  breathing: { min: 0, max: 0.2, step: 0.005 },
  shininess: { min: 0, max: 200, step: 1 },
  opacity: { min: 0.15, max: 1, step: 0.01 },
  lightIntensity: { min: 0, max: 2.5, step: 0.05 },
  resolution: { min: 120, max: 220, step: 10 },
}

/**
 * How the studio lays the tunables out.
 *
 * Twenty sliders in one flat grid is a wall, and a creator faced with a wall
 * moves nothing. Grouped, each section is a question with an answer — what
 * shape, how it moves, what it is made of — and the labels are what a person
 * would call the thing rather than what the uniform is called.
 *
 * Data rather than markup because the mint studio and the owner's edit screen
 * both render it, and two hand-written copies of a twenty-row form is two
 * copies to forget to update.
 */
export interface TuningGroup {
  id: string
  label: string
  hint: string
  rows: Array<{
    /** Rendered as one slider per key. Three keys make a linked XYZ row. */
    keys: Array<keyof KwamiTuning>
    label: string
  }>
}

export const TUNING_GROUPS: TuningGroup[] = [
  {
    id: 'shape',
    label: 'Shape',
    hint: 'How far the surface travels and how finely it breaks up.',
    rows: [
      { keys: ['amplitude'], label: 'Displacement' },
      { keys: ['frequency'], label: 'Detail' },
      { keys: ['spikeX', 'spikeY', 'spikeZ'], label: 'Detail per axis' },
      { keys: ['ampX', 'ampY', 'ampZ'], label: 'Displacement per axis' },
      { keys: ['resolution'], label: 'Mesh resolution' },
    ],
  },
  {
    id: 'motion',
    label: 'Motion',
    hint: 'What it does while nobody is talking to it.',
    rows: [
      { keys: ['spin'], label: 'Spin' },
      { keys: ['breathing'], label: 'Breathing' },
      { keys: ['timeX', 'timeY', 'timeZ'], label: 'Morph speed per axis' },
      { keys: ['reactivity'], label: 'Voice reactivity' },
    ],
  },
  {
    id: 'surface',
    label: 'Surface',
    hint: 'The material itself — how it catches light and how solid it is.',
    rows: [
      { keys: ['shininess'], label: 'Shininess' },
      { keys: ['opacity'], label: 'Opacity' },
      { keys: ['lightIntensity'], label: 'Inner light' },
      { keys: ['rimPower'], label: 'Rim tightness' },
      { keys: ['particles'], label: 'Orbiting sparks' },
    ],
  },
]

const TUNING_KEYS = Object.keys(TUNING_RANGES) as Array<keyof KwamiTuning>

/**
 * Read whatever tuning a stored appearance carries.
 *
 * Per-key rather than all-or-nothing, unlike `paletteFor`. The palette is a
 * *pairing* — one valid colour beside one default produces a combination nobody
 * chose — but the tunables are independent, and a Kwami whose spin survived a
 * bad amplitude is still the object its creator designed in every respect that
 * parsed.
 */
export function readTuning(appearance: Record<string, unknown> | null | undefined): Partial<KwamiTuning> {
  const raw = appearance?.tuning
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Record<string, unknown>

  const out: Partial<KwamiTuning> = {}
  for (const key of TUNING_KEYS) {
    const value = source[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const { min, max } = TUNING_RANGES[key]
    out[key] = Math.max(min, Math.min(max, value))
  }
  return out
}

/**
 * Normalise tuning for storage, dropping anything that is not a real override.
 *
 * Returns `undefined` rather than `{}` when nothing survives, so `toAppearance`
 * can leave the key off the stored object entirely instead of writing an empty
 * one that later reads as "tuned, to nothing".
 */
export function toTuning(tuning: Partial<KwamiTuning> | null | undefined): Partial<KwamiTuning> | undefined {
  const cleaned = readTuning({ tuning: tuning ?? {} })
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}
