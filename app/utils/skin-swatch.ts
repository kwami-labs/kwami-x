/**
 * A CSS approximation of each skin, for the picker.
 *
 * Twenty-two live previews would be twenty-two WebGL contexts, and browsers
 * silently kill the oldest once a page holds more than about sixteen — the
 * gallery would take out the stage it is sitting next to. `kwami-field.ts`
 * exists for exactly that reason on the sign-in screen.
 *
 * So the swatches are CSS, built from the creator's own three colours. They are
 * not the shader and are not trying to be: their job is to say *which* of the
 * twenty-two this one is, well enough that someone scanning the grid can tell
 * `stepped` from `flat` and `chrome` from `metallic` before clicking. The
 * Kwami on the stage next to it is the real answer.
 */
import type { KwamiSkin } from '#shared/types/kwami'

export function skinSwatch(skin: KwamiSkin, a: string, b: string, c: string): string {
  switch (skin) {
    case 'radial':
      return `conic-gradient(from 210deg, ${a}, ${b}, ${c}, ${a})`
    case 'banded':
      return `linear-gradient(${a} 0 32%, ${b} 32% 68%, ${c} 68%)`
    case 'striped':
      return `repeating-linear-gradient(48deg, ${a} 0 7px, ${b} 7px 12px, ${c} 12px 17px)`
    case 'marble':
      return `radial-gradient(120% 90% at 20% 15%, ${b}, transparent 55%),
              radial-gradient(90% 120% at 80% 70%, ${c}, transparent 60%), ${a}`
    case 'fresnel':
      return `radial-gradient(circle at 50% 50%, ${a} 0 18%, transparent 42%, ${b} 88%), ${c}`
    case 'iridescent':
      return `conic-gradient(from 90deg, ${a}, ${b}, ${c}, ${b}, ${a})`
    case 'spiral':
      return `repeating-conic-gradient(from 0deg, ${a} 0 12%, ${b} 12% 24%, ${c} 24% 36%)`
    case 'plasma':
      return `radial-gradient(60% 60% at 25% 30%, ${b}, transparent 70%),
              radial-gradient(70% 70% at 75% 70%, ${c}, transparent 70%), ${a}`
    case 'gradient':
      return `linear-gradient(160deg, ${a}, ${b} 55%, ${c})`
    case 'matte':
      return `radial-gradient(circle at 34% 28%, ${a}, color-mix(in srgb, ${a} 55%, black))`
    case 'glossy':
      return `radial-gradient(circle at 32% 24%, #fff 0 6%, ${a} 30%,
              color-mix(in srgb, ${a} 45%, black))`
    case 'metallic':
      return `linear-gradient(120deg, color-mix(in srgb, ${a} 30%, black), ${a} 38%,
              #fff 48%, ${a} 60%, color-mix(in srgb, ${a} 25%, black))`
    case 'subsurface':
      return `radial-gradient(circle at 62% 62%, color-mix(in srgb, ${a} 70%, #ffd6c2) 0 30%, ${a} 75%,
              color-mix(in srgb, ${a} 55%, black))`
    case 'chrome':
      return `linear-gradient(105deg, #0b0d12, #cfd6e4 22%, #6d7789 38%, #f2f5fb 54%, #4b5364 72%, #0b0d12)`
    case 'clay':
      return `radial-gradient(circle at 34% 26%, color-mix(in srgb, ${a} 75%, #ffd9b0), ${a} 60%,
              color-mix(in srgb, ${a} 50%, #3a2a20))`
    case 'jade':
      return `radial-gradient(circle at 42% 40%, color-mix(in srgb, ${a} 65%, #d8ffe9) 0 22%, ${a} 62%,
              color-mix(in srgb, ${a} 40%, black))`
    case 'toon-matcap':
      return `radial-gradient(circle at 34% 28%, ${a} 0 34%,
              color-mix(in srgb, ${a} 58%, black) 34% 68%, color-mix(in srgb, ${a} 28%, black) 68%)`
    case 'hologram':
      return `conic-gradient(from 40deg, #ff5cb8, #7ee7ff, #c8ff5e, #a77bff, #ff5cb8)`
    case 'flat':
      return `linear-gradient(120deg, ${a} 0 52%, color-mix(in srgb, ${a} 40%, black) 52%)`
    case 'stepped':
      return `radial-gradient(circle at 32% 26%, ${a} 0 26%, ${b} 26% 48%,
              color-mix(in srgb, ${b} 60%, ${a}) 48% 72%, color-mix(in srgb, ${a} 30%, black) 72%)`
    case 'halftone':
      return `radial-gradient(${a} 34%, transparent 36%) 0 0 / 7px 7px, ${b}`
    case 'outlined':
      return `radial-gradient(circle at 42% 38%, ${a} 0 58%, color-mix(in srgb, ${a} 12%, black) 78%)`
  }
}
