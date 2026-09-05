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

export interface KwamiAppearance {
  /** Core colour, `#rrggbb`. */
  colorA: string
  /** Rim and displacement-peak colour, `#rrggbb`. */
  colorB: string
}

export interface Palette {
  a: string
  b: string
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
  { id: 'amethyst', label: 'Amethyst', a: '#7c5cff', b: '#3ddc97' },
  { id: 'ember', label: 'Ember', a: '#ff7a45', b: '#ffd166' },
  { id: 'abyss', label: 'Abyss', a: '#1f6feb', b: '#7ee7ff' },
  { id: 'venom', label: 'Venom', a: '#39e08c', b: '#c8ff5e' },
  { id: 'orchid', label: 'Orchid', a: '#ff5cb8', b: '#a77bff' },
  { id: 'bullion', label: 'Bullion', a: '#f5c451', b: '#ff9d3d' },
  { id: 'glacier', label: 'Glacier', a: '#7ee7ff', b: '#e6f1ff' },
  { id: 'ruin', label: 'Ruin', a: '#ff5c72', b: '#ff9d3d' },
  { id: 'moss', label: 'Moss', a: '#4fb286', b: '#d8f36b' },
  { id: 'signal', label: 'Signal', a: '#00d4ff', b: '#ff2bd1' },
  { id: 'dusk', label: 'Dusk', a: '#5d5fef', b: '#ff8fab' },
  { id: 'ash', label: 'Ash', a: '#8b93a7', b: '#dfe4ef' },
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
  return { a: hslToHex(hueA, 0.78, 0.62), b: hslToHex(hueA + 140, 0.72, 0.58) }
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
  if (isHexColor(a) && isHexColor(b)) return { a, b }
  return paletteFromMint(kwami.mint ?? '')
}

/** Normalise a chosen palette for storage. Returns `{}` when it is not usable. */
export function toAppearance(palette: Partial<Palette>): Record<string, string> {
  if (!isHexColor(palette.a) || !isHexColor(palette.b)) return {}
  return { colorA: palette.a, colorB: palette.b }
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
