/**
 * A stable colour pair derived from a Kwami's mint, so it looks the same everywhere.
 *
 * The comma syntax is load-bearing. `hsl(200 78% 62%)` — CSS Color 4's space-separated form —
 * is valid CSS but three.js cannot parse it: `Color.setStyle` matches
 * `/^\s*(\d*\.?\d+)\s*,\s*…/`, falls through, and leaves the colour at its default WHITE. That
 * is what every Kwami avatar rendered. `hsl(200, 78%, 62%)` is understood by both, so one
 * string can drive the CSS gradients, the SVG thumbnail and the WebGL material alike.
 *
 * Do not "modernise" this to the space-separated form without checking three's parser first;
 * `tests/unit/palette.test.ts` asserts the round trip through an actual THREE.Color.
 */
export function paletteFromMint(mint: string): { a: string; b: string } {
  let hash = 0
  for (let i = 0; i < mint.length; i++) hash = (hash * 31 + mint.charCodeAt(i)) >>> 0
  const hueA = hash % 360
  // Complementary-ish rather than exactly opposite: 140° keeps both colours
  // inside a range that stays legible against the dark surface.
  const hueB = (hueA + 140) % 360
  return { a: `hsl(${hueA}, 78%, 62%)`, b: `hsl(${hueB}, 72%, 58%)` }
}
