/**
 * The surfaces a Kwami can wear.
 *
 * A body (`KwamiRenderer`) says how the Kwami *moves* — how far the surface
 * travels, how fast it turns, whether it carries a cloud. A skin says what that
 * surface is *made of*. They are orthogonal on purpose: the same restless
 * silhouette reads as molten glass or as brushed steel depending on nothing but
 * this field, which is twenty-two more looks than five bodies alone could
 * offer.
 *
 * The catalogue is the same one the desktop app ships, so a Kwami designed
 * here, a Kwami in the arena and a Kwami in the desktop companion are the same
 * object rather than three interpretations of one name. It lives in `shared/`
 * with no runtime dependency, because the mint endpoint has to validate the
 * field and the shader has to compile it, and a list that lived in only one of
 * those two places would drift the moment a skin was added.
 */

export type KwamiSkin =
  // Colour-driven: the three chosen colours are the whole surface.
  | 'radial'
  | 'banded'
  | 'striped'
  | 'marble'
  | 'fresnel'
  | 'iridescent'
  | 'spiral'
  | 'plasma'
  | 'gradient'
  // Material: one colour, lit like a substance.
  | 'matte'
  | 'glossy'
  | 'metallic'
  | 'subsurface'
  | 'chrome'
  | 'clay'
  | 'jade'
  // Stylised: drawn rather than lit.
  | 'toon-matcap'
  | 'hologram'
  | 'flat'
  | 'stepped'
  | 'halftone'
  | 'outlined'

export type SkinFamily = 'colour' | 'material' | 'stylised'

export interface SkinDefinition {
  id: KwamiSkin
  label: string
  family: SkinFamily
  /** One line, shown under the gallery. What it looks like, not how it works. */
  note: string
  /**
   * Specular power, 0–200.
   *
   * Not taste: each skin's shader reads this on a different curve — `chrome`
   * squares it into a mirror highlight, `matte` barely uses it — so a single
   * global default would give half the catalogue the wrong surface.
   */
  shininess: number
  /** Resting opacity. Below 1 the skin renders with depth writes off. */
  opacity: number
  /**
   * How many of the three colours the skin actually reads.
   *
   * Drives the studio: showing three colour pickers for `matte`, which only
   * ever samples the first, invites someone to spend a minute on two swatches
   * that change nothing.
   */
  colors: 1 | 2 | 3
}

/**
 * Every skin, in gallery order.
 *
 * Ordered by family rather than alphabetically — someone scanning for "a
 * metal" is scanning for a region of the grid, not for a letter.
 */
export const KWAMI_SKINS: SkinDefinition[] = [
  {
    id: 'radial',
    label: 'Radial',
    family: 'colour',
    note: 'Three colours swept around the vertical axis. The house default.',
    shininess: 50,
    opacity: 1,
    colors: 3,
  },
  {
    id: 'banded',
    label: 'Banded',
    family: 'colour',
    note: 'Stacked horizontally — a bright middle between two poles.',
    shininess: 45,
    opacity: 1,
    colors: 3,
  },
  {
    id: 'striped',
    label: 'Striped',
    family: 'colour',
    note: 'Hard vintage stripes running through the body.',
    shininess: 50,
    opacity: 1,
    colors: 3,
  },
  {
    id: 'marble',
    label: 'Marble',
    family: 'colour',
    note: 'Veined and mineral. No two angles look the same.',
    shininess: 65,
    opacity: 1,
    colors: 3,
  },
  {
    id: 'fresnel',
    label: 'Fresnel',
    family: 'colour',
    note: 'Hollow and glowing at the edge. Reads as gas rather than solid.',
    shininess: 120,
    opacity: 0.9,
    colors: 3,
  },
  {
    id: 'iridescent',
    label: 'Iridescent',
    family: 'colour',
    note: 'Oil-slick shift — the colour depends on where you stand.',
    shininess: 90,
    opacity: 1,
    colors: 3,
  },
  {
    id: 'spiral',
    label: 'Spiral',
    family: 'colour',
    note: 'Twisted around the body like a barber pole.',
    shininess: 55,
    opacity: 1,
    colors: 3,
  },
  {
    id: 'plasma',
    label: 'Plasma',
    family: 'colour',
    note: 'Colours boil across the surface on their own clock.',
    shininess: 40,
    opacity: 1,
    colors: 3,
  },
  {
    id: 'gradient',
    label: 'Gradient',
    family: 'colour',
    note: 'A clean vertical fade. The quietest of the three-colour skins.',
    shininess: 70,
    opacity: 1,
    colors: 3,
  },
  {
    id: 'matte',
    label: 'Matte',
    family: 'material',
    note: 'Chalk. Soft wrapped light, no highlight at all.',
    shininess: 10,
    opacity: 1,
    colors: 1,
  },
  {
    id: 'glossy',
    label: 'Glossy',
    family: 'material',
    note: 'Wet enamel with one tight highlight.',
    shininess: 150,
    opacity: 1,
    colors: 1,
  },
  {
    id: 'metallic',
    label: 'Metallic',
    family: 'material',
    note: 'Anodised. Colour lives in the reflection, not the diffuse.',
    shininess: 120,
    opacity: 1,
    colors: 1,
  },
  {
    id: 'subsurface',
    label: 'Subsurface',
    family: 'material',
    note: 'Light passes through it. Wax, skin, or something alive.',
    shininess: 30,
    opacity: 0.92,
    colors: 1,
  },
  {
    id: 'chrome',
    label: 'Chrome',
    family: 'material',
    note: 'A mirror. Almost all of what you see is the room.',
    shininess: 180,
    opacity: 1,
    colors: 1,
  },
  {
    id: 'clay',
    label: 'Clay',
    family: 'material',
    note: 'Unfired and earthen. Warm on top, cool underneath.',
    shininess: 25,
    opacity: 1,
    colors: 1,
  },
  {
    id: 'jade',
    label: 'Jade',
    family: 'material',
    note: 'Dense stone with a lit core. Reads as expensive.',
    shininess: 80,
    opacity: 1,
    colors: 1,
  },
  {
    id: 'toon-matcap',
    label: 'Toon',
    family: 'stylised',
    note: 'Three flat bands. Drawn rather than lit.',
    shininess: 40,
    opacity: 1,
    colors: 1,
  },
  {
    id: 'hologram',
    label: 'Hologram',
    family: 'stylised',
    note: 'Projected, not present. Rainbow interference at the edges.',
    shininess: 100,
    opacity: 0.85,
    colors: 1,
  },
  {
    id: 'flat',
    label: 'Flat',
    family: 'stylised',
    note: 'Two tones and a hard terminator. Poster art.',
    shininess: 20,
    opacity: 1,
    colors: 1,
  },
  {
    id: 'stepped',
    label: 'Stepped',
    family: 'stylised',
    note: 'Light quantised into four steps. Cel shading.',
    shininess: 30,
    opacity: 1,
    colors: 2,
  },
  {
    id: 'halftone',
    label: 'Halftone',
    family: 'stylised',
    note: 'Printed in dots. The shading is the dot size.',
    shininess: 20,
    opacity: 1,
    colors: 2,
  },
  {
    id: 'outlined',
    label: 'Outlined',
    family: 'stylised',
    note: 'Inked silhouette around a soft fill.',
    shininess: 40,
    opacity: 1,
    colors: 1,
  },
]

export const SKIN_FAMILIES: Array<{ id: SkinFamily; label: string }> = [
  { id: 'colour', label: 'Colour' },
  { id: 'material', label: 'Material' },
  { id: 'stylised', label: 'Stylised' },
]

/**
 * What a Kwami wears when nobody chose.
 *
 * `radial` rather than a flat material: it is the one skin that puts all three
 * of a creator's colours on screen at once, so the first thing anyone sees on
 * the mint page is the palette doing something.
 */
export const DEFAULT_SKIN: KwamiSkin = 'radial'

const BY_ID = new Map(KWAMI_SKINS.map((s) => [s.id, s]))

export function isSkin(value: unknown): value is KwamiSkin {
  return typeof value === 'string' && BY_ID.has(value as KwamiSkin)
}

/** The definition for a skin id, falling back rather than throwing. */
export function skinDefinition(id: string | null | undefined): SkinDefinition {
  return BY_ID.get(id as KwamiSkin) ?? BY_ID.get(DEFAULT_SKIN)!
}

export function skinsOfFamily(family: SkinFamily): SkinDefinition[] {
  return KWAMI_SKINS.filter((s) => s.family === family)
}

/**
 * The shininess and opacity a skin wants, as tuning overrides.
 *
 * Picking a skin should land on that material looking right, and that means
 * moving two sliders the creator did not touch — `chrome` at `matte`'s
 * shininess is a grey ball, and `hologram` at full opacity is not a hologram.
 * Returned as overrides rather than applied in place so the caller can merge
 * them into whatever it is already storing.
 */
export function tuningForSkin(skin: string): { shininess: number; opacity: number } {
  const definition = skinDefinition(skin)
  return { shininess: definition.shininess, opacity: definition.opacity }
}
