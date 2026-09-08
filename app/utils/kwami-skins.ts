/**
 * The twenty-two surfaces, as GLSL.
 *
 * Each entry is the body of one function — `vec3 kwamiSurface()` — compiled
 * into the fragment shader on its own. Not a `uniform int uSkin` and a
 * twenty-two-way branch: every pixel would then pay for every skin in the
 * catalogue, and a phone rendering a grid of Kwami cards would run the marble
 * noise on a Kwami wearing `flat`. One skin, one program, compiled when the
 * creator picks it.
 *
 * A body reads these globals, which `KWAMI_FRAGMENT_MAIN` sets up first:
 *
 *   nrm      surface normal, view space, unit
 *   vw       direction to the eye, view space, unit
 *   pos      displaced position in object space, |pos| ≈ 1
 *   c1 c2 c3 the creator's three colours, linear
 *   shiny    0–200, the creator's shininess
 *   specPow  / specAmt   shininess split into a Phong exponent and a weight
 *   fres     Fresnel term, 0 head-on to 1 at the silhouette
 *   skinAlpha   starts at 1; a body may lower it (`fresnel`, `hologram`)
 *
 * They are ports of the desktop app's skins rather than reinterpretations, so
 * a Kwami wearing `jade` is the same jade in both places. The one deliberate
 * change is the light: the desktop shaders take an object-space light position
 * and dot it against a view-space normal, which happens to look good and does
 * not survive being moved to a renderer whose camera is somewhere else. Here
 * every skin lights from one view-space key, so the highlight lands where the
 * geometry says it should.
 */
import type { KwamiSkin } from '#shared/types/kwami'

/**
 * Shared helpers every skin body may call.
 *
 * `snoise` is only reached by `marble`, but it lives here rather than inside
 * that one body because the vertex shader needs the identical function and two
 * copies of a hundred lines of simplex noise is two things to fix.
 */
export const KWAMI_SKIN_PRELUDE = `
/**
 * Key light, view space: over the viewer's shoulder and above.
 *
 * Written out already normalised rather than as normalize(vec3(0.36, 0.86,
 * 0.36)). A GLSL ES 1.00 const initialiser has to be a constant expression and
 * a builtin call is not one, so the normalised form fails to compile — and it
 * fails as a shader link error inside a WebGL context, which surfaces as a
 * Kwami that is simply not drawn rather than as anything resembling an error.
 */
const vec3 KEY = vec3(0.3602, 0.8605, 0.3602);
/** A cool bounce from below, so the unlit side is shadow and not a hole. */
const vec3 FILL = vec3(-0.5911, -0.7037, 0.3941);

/** Lambert, wrapped. A hard terminator on a small dark object reads as a moon. */
float wrapped(vec3 n, vec3 l, float w) {
  return max((dot(n, l) + w) / (1.0 + w), 0.0);
}

float phong(vec3 n, vec3 l, vec3 v, float power) {
  return pow(max(dot(v, reflect(-l, n)), 0.0), power);
}

/** Blinn-Phong. Tighter and cheaper than the reflect() form for hard highlights. */
float blinn(vec3 n, vec3 l, vec3 v, float power) {
  return pow(max(dot(n, normalize(l + v)), 0.0), power);
}

/**
 * The house three-point light, applied to a colour a skin has already worked out.
 *
 * Every colour-driven skin shares it, so a creator comparing marble against
 * spiral is comparing the two patterns rather than two different rooms.
 *
 * The numbers are an exposure, and the exposure is the whole difference
 * between a Kwami that reads as an object and one that reads as a sticker.
 * They were first written far too generous — a wide wrap, a bright ambient
 * floor and an additive rim that between them left no unlit side at all — and
 * the result was a pastel blob with its shadow terminator bleached out. The
 * squared falloff and the near-black ambient are what put the shadow back.
 */
vec3 lit(vec3 base) {
  float key = wrapped(nrm, KEY, 0.3);
  float fill = max(dot(nrm, FILL), 0.0) * 0.2;
  // Tied to the key so the highlight cannot appear on the shadow side, which
  // is where an unweighted Blinn term puts one on a displaced surface.
  float spec = blinn(nrm, KEY, vw, max(12.0, specPow)) * specAmt * (0.3 + 0.7 * key);
  return base * (0.05 + 0.82 * key * key + fill) + vec3(spec);
}

/**
 * A studio environment, sampled by direction.
 *
 * The reflective skins used to fake one with a matcap read out of nrm.xy,
 * which is a lookup into a texture that does not exist. It only ever worked by
 * accident on a smooth sphere: on a displaced blob the normal's z component
 * sits near 1 across most of the visible surface, so the "lookup" collapsed to
 * a constant and chrome, jade, clay and toon all rendered as the same flat
 * wash of the creator's first colour — twenty-two skins that were four.
 *
 * A gradient with a horizon in it and a bright key disc costs about the same
 * arithmetic and is an actual room, so a mirror has something to be a mirror
 * of. Deliberately low-key: a Kwami sits on a near-black page, and an
 * environment brighter than the page turns every metal into a light bulb.
 */
vec3 envSample(vec3 r) {
  float y = r.y * 0.5 + 0.5;
  vec3 ground = mix(vec3(0.025, 0.023, 0.022), vec3(0.10, 0.10, 0.11), smoothstep(0.0, 0.5, y));
  vec3 sky = mix(vec3(0.15, 0.17, 0.22), vec3(0.52, 0.60, 0.76), smoothstep(0.5, 1.0, y));
  vec3 env = mix(ground, sky, smoothstep(0.44, 0.56, y));
  env += vec3(1.0, 0.97, 0.90) * pow(max(dot(r, KEY), 0.0), 42.0) * 2.6;
  env += vec3(0.30, 0.45, 0.75) * pow(max(dot(r, FILL), 0.0), 8.0) * 0.35;
  return env;
}

/**
 * Where this pixel sits on the shape: 0 deep in a crease, 1 on a crest.
 *
 * vDisplace is the one thing the vertex shader knows about the silhouette
 * that the fragment shader cannot work out for itself, and every material skin
 * was discarding it. Darkening the valleys is most of what stops a displaced
 * sphere reading as a ball someone painted a gradient on.
 */
float cavity() {
  return clamp(0.5 + vDisplace * 2.4, 0.0, 1.0);
}
`

/**
 * The skin bodies.
 *
 * Kept as one record rather than one file each: they are four to twenty lines
 * of shader apiece, and twenty-two files of that size costs more to read
 * through than it saves.
 */
export const KWAMI_SKIN_BODIES: Record<KwamiSkin, string> = {
  // ── Colour: the three chosen colours are the whole surface ──────────────

  /**
   * Three colours swept around the vertical axis.
   *
   * Around Y rather than around Z, which is where the desktop app sweeps it.
   * The three weights meet at a single point on the axis, and on Z that point
   * is aimed straight at the camera — the Kwami wears a colour wheel with a
   * visible pinch in the middle of its face. On Y the same singularity sits at
   * the poles, where the silhouette hides it.
   *
   * The weights are sharpened before they are normalised. Three cosines that
   * sum to one put all three colours everywhere, and the average of three hues
   * is grey: unsharpened, a vivid palette renders as pastel.
   */
  radial: `
  float angle = atan(pos.z, pos.x);
  vec3 w = 0.5 + 0.5 * vec3(cos(angle), cos(angle - 2.09439510239), cos(angle - 4.18879020479));
  w = w * w * w;
  w /= (w.x + w.y + w.z + 0.0001);
  return lit(c1 * w.x + c2 * w.y + c3 * w.z);
`,

  /** Stacked horizontally — a bright middle between two poles. */
  banded: `
  float t = clamp(pos.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 base = t > 0.66
    ? mix(c2, c1, smoothstep(0.0, 1.0, (t - 0.66) / 0.34))
    : (t > 0.33 ? c2 : mix(c3, c2, smoothstep(0.0, 1.0, t / 0.33)));
  return lit(base);
`,

  /** Hard vintage stripes running through the body. */
  striped: `
  float sx = smoothstep(0.45, 0.55, mod(pos.x * 5.0 + 0.5, 1.0));
  float sy = smoothstep(0.45, 0.55, mod(pos.y * 5.0 + 0.5, 1.0));
  return lit(mix(mix(c1, c2, sx), c3, sy * 0.5));
`,

  /** Veined and mineral. No two angles look the same. */
  marble: `
  float n1 = snoise(pos * 1.8) * 0.5 + 0.5;
  float n2 = snoise(pos * 3.2 + vec3(5.2, 1.3, 2.8)) * 0.5 + 0.5;
  float n3 = snoise(pos * 0.9 + vec3(9.1, 4.7, 6.3)) * 0.5 + 0.5;
  // The floor matters: all three smoothsteps can land near zero at the same
  // point, and normalising 0/0.001 paints a black vein through the marble that
  // no palette can explain.
  vec3 w = vec3(smoothstep(0.2, 0.8, n1), smoothstep(0.3, 0.7, n2), smoothstep(0.25, 0.75, n3));
  w = w * w + 0.04;
  w /= (w.x + w.y + w.z);
  return lit(c1 * w.x + c2 * w.y + c3 * w.z);
`,

  /** Hollow and glowing at the edge. Reads as gas rather than solid. */
  fresnel: `
  float f = pow(fres, 2.5);
  vec3 core = c1 * 0.6 + c2 * 0.4;
  vec3 rim = c2 * 0.4 + c3 * 0.6;
  vec3 glow = c3 * 0.5 + c1 * 0.5;
  vec3 base = mix(core * 0.75, rim * 1.15, f) + glow * pow(fres, 4.0) * 0.6;
  skinAlpha = mix(0.34, 1.0, f);
  return base + vec3(blinn(nrm, KEY, vw, specPow) * specAmt);
`,

  /** Oil-slick shift — the colour depends on where you stand. */
  iridescent: `
  float shift = fres * 3.0 + (dot(nrm, KEY) * 0.5 + 0.5) * 2.0;
  vec3 w = 0.5 + 0.5 * vec3(
    cos(shift * 6.28318),
    cos(shift * 6.28318 + 2.094),
    cos(shift * 6.28318 + 4.189));
  w /= (w.x + w.y + w.z + 0.001);
  vec3 base = c1 * w.x + c2 * w.y + c3 * w.z;
  base = mix(base, base.gbr, pow(fres, 1.5) * 0.4);
  return lit(base) + vec3(blinn(nrm, KEY, vw, max(48.0, specPow)) * specAmt * 0.8);
`,

  /** Twisted around the body like a barber pole. */
  spiral: `
  float phase = (atan(pos.z, pos.x) + pos.y * 4.5) * 1.5;
  vec3 w = 0.5 + 0.5 * vec3(cos(phase), cos(phase - 2.09439510239), cos(phase - 4.18879020479));
  w = w * w * w;
  w /= (w.x + w.y + w.z + 0.0001);
  return lit(c1 * w.x + c2 * w.y + c3 * w.z);
`,

  /** Colours boil across the surface on their own clock. */
  plasma: `
  float t = uTime * 0.35;
  float p1 = sin(pos.x * 2.5 + t * 1.3) * cos(pos.y * 2.8 - t * 0.9) + sin(pos.z * 2.2 + t * 1.1);
  float p2 = cos(pos.y * 3.1 - t * 1.5) * sin(pos.z * 2.6 + t * 1.2) + cos(pos.x * 2.9 - t * 0.8);
  float p3 = sin(pos.z * 2.7 + t * 1.7) * cos(pos.x * 3.0 - t * 1.4) + sin(pos.y * 2.4 + t * 1.0);
  // Floored for the same reason as marble: the three waves can trough together.
  vec3 w = vec3(p1, p2, p3) * 0.5 + 0.5;
  w = max(w, vec3(0.0));
  w = w * w + 0.04;
  w /= (w.x + w.y + w.z);
  return lit(c1 * w.x + c2 * w.y + c3 * w.z);
`,

  /** A clean vertical fade. The quietest of the three-colour skins. */
  gradient: `
  float t = clamp(pos.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 base = t < 0.5
    ? mix(c3, c2, smoothstep(0.0, 1.0, t * 2.0))
    : mix(c2, c1, smoothstep(0.0, 1.0, (t - 0.5) * 2.0));
  return lit(base);
`,

  // ── Material: one colour, lit like a substance ──────────────────────────

  /** Chalk. Soft wrapped light, no highlight at all. */
  matte: `
  float d = wrapped(nrm, KEY, 0.35);
  float fill = max(dot(nrm, FILL), 0.0) * 0.22;
  return c1 * (d * 0.92 + fill) * mix(0.6, 1.0, cavity()) + c1 * 0.05;
`,

  /** Wet enamel with one tight highlight. */
  glossy: `
  float ndl = max(dot(nrm, KEY), 0.0);
  float spec = blinn(nrm, KEY, vw, max(24.0, shiny * 2.0)) * (shiny / 200.0 + 0.12);
  float fill = max(dot(nrm, FILL), 0.0) * 0.18;
  // A clear coat: the environment shows up faintly head-on and hard at the
  // edges, which is the difference between wet plastic and a bright colour.
  vec3 coat = envSample(reflect(-vw, nrm)) * (0.08 + 0.55 * pow(fres, 3.0));
  vec3 body = (c1 * ndl * 0.9 + c1 * fill + c1 * 0.05) * mix(0.68, 1.0, cavity());
  return body + coat + vec3(spec) * (0.3 + 0.7 * ndl);
`,

  /** Anodised. Colour lives in the reflection, not the diffuse. */
  metallic: `
  // A metal has no diffuse term worth the name: its colour lives in what it
  // reflects, so the tint goes on the environment rather than on the surface.
  // Tinting the surface instead is what made this indistinguishable from a
  // shiny plastic of the same hue.
  vec3 r = reflect(-vw, nrm);
  // Roughness blurs the reflection. There is no mip chain here, so it is faked
  // by fading the sharp reflection towards the environment in the direction the
  // surface faces — smooth at high shininess, milky at low.
  float rough = clamp(1.0 - shiny / 200.0, 0.08, 0.9);
  vec3 env = mix(envSample(r), envSample(normalize(nrm + KEY * 0.6)), rough * 0.7);
  vec3 tint = mix(c1, vec3(1.0), 0.12);
  float spec = blinn(nrm, KEY, vw, max(8.0, shiny * 1.4)) * (0.5 + shiny / 120.0);
  return env * tint * mix(0.5, 1.15, cavity()) + tint * spec * 0.6;
`,

  /** Light passes through it. Wax, skin, or something alive. */
  subsurface: `
  float ndl = dot(nrm, KEY);
  vec3 warm = vec3(1.0, 0.84, 0.74);
  vec3 base = c1 * clamp(ndl * 0.4 + 0.6, 0.0, 1.0);
  vec3 thru = c1 * warm * clamp(-ndl * 0.55 + 0.52, 0.0, 1.0) * 0.7;
  vec3 transl = c1 * warm * pow(fres, 2.2) * 0.45;
  // Light that has travelled through the body pools where the body is thin, so
  // the creases stay dense and the crests glow. Without it the scatter is flat
  // and the Kwami reads as backlit paper.
  return (base + thru) * mix(0.66, 1.06, cavity()) + transl;
`,

  /** A mirror. Almost all of what you see is the room. */
  chrome: `
  // A mirror, which means the environment almost undiluted. The creator's
  // colour survives only as a faint plating tint: chrome that takes its hue
  // from a swatch is not chrome, and the old version multiplied the whole
  // surface by it.
  vec3 env = envSample(reflect(-vw, nrm));
  // Schlick. Reflectance climbs to full white at grazing angles, and that ramp
  // around the silhouette is most of what separates chrome from grey paint.
  vec3 refl = mix(mix(vec3(0.95), c1, 0.22), vec3(1.0), pow(fres, 5.0));
  float spec = phong(nrm, KEY, vw, max(shiny * 0.6, 120.0));
  return env * refl * mix(0.45, 1.2, cavity()) + vec3(spec * 1.6);
`,

  /** Unfired and earthen. Warm on top, cool underneath. */
  clay: `
  // Warm key, cool bounce, and the creases doing all the work. Clay has almost
  // no highlight to read the form by, so if the displacement is not in the
  // shading there is nothing left and the surface is flat paint — which is
  // exactly what it was while it shaded off a made-up matcap coordinate.
  float key = wrapped(nrm, KEY, 0.25);
  float fill = max(dot(nrm, FILL), 0.0) * 0.3;
  vec3 base = mix(c1 * vec3(0.70, 0.76, 0.94), c1 * vec3(1.06, 0.93, 0.82), key);
  float spec = blinn(nrm, KEY, vw, 12.0) * 0.05;
  return base * (0.09 + 0.85 * key + fill) * mix(0.46, 1.0, cavity()) + vec3(spec);
`,

  /** Dense stone with a lit core. Reads as expensive. */
  jade: `
  // Light travelling through the stone rather than off it. The glow belongs
  // where the body is thin — the silhouette and the crests — and the core
  // stays dark and saturated, which is the whole read of a carved stone and
  // the opposite of the evenly-lit lozenge this used to produce.
  float key = wrapped(nrm, KEY, 0.45);
  vec3 glow = mix(c1, c1 * vec3(0.75, 1.25, 1.0) + vec3(0.04, 0.14, 0.10), 0.6);
  vec3 stone = mix(c1 * vec3(0.40, 0.60, 0.48) * (0.12 + 0.7 * key), glow, pow(fres, 1.9) * 0.75);
  // A little light bleeding through from behind, so it is stone rather than paint.
  stone += glow * pow(max(dot(nrm, -KEY), 0.0), 2.0) * 0.18;
  float spec = blinn(nrm, KEY, vw, max(40.0, shiny * 1.6)) * (0.25 + shiny / 400.0);
  return stone * mix(0.6, 1.06, cavity()) + vec3(spec);
`,

  // ── Stylised: drawn rather than lit ─────────────────────────────────────

  /** Three flat bands. Drawn rather than lit. */
  'toon-matcap': `
  // Banded on the light, not on which way the pixel happens to face. The old
  // version quantised nrm.z, which is ~1 across the entire front of a blob,
  // so every Kwami wearing this came out one flat colour with no bands at all
  // — a cel shader that never drew a cel.
  float key = wrapped(nrm, KEY, 0.15);
  vec3 tone = mix(c1 * 0.22, c1, floor(clamp(key, 0.0, 0.999) * 4.0) / 3.0);
  // The hard chip and the hard rim are the rest of the look; both are steps
  // rather than ramps, because a soft edge anywhere gives the ink away.
  tone += vec3(1.0) * step(0.86, blinn(nrm, KEY, vw, 48.0)) * 0.5;
  return mix(tone, mix(c1, vec3(1.0), 0.4), step(0.72, fres));
`,

  /** Projected, not present. Rainbow interference at the edges. */
  hologram: `
  vec2 mc = nrm.xy * 0.5 + 0.5;
  float ang = atan(mc.y - 0.5, mc.x - 0.5) + nrm.z * 0.8;
  vec3 rainbow = 0.5 + 0.5 * vec3(cos(ang), cos(ang + 2.094), cos(ang + 4.189));
  vec3 holo = mix(c1, rainbow, 0.65) + vec3(0.45, 0.75, 1.0) * pow(fres, 2.2) * 0.85;
  skinAlpha = mix(0.7, 1.0, pow(fres, 2.2));
  return holo;
`,

  /** Two tones and a hard terminator. Poster art. */
  flat: `
  return mix(c1 * 0.4, c1, step(0.45, max(dot(nrm, KEY), 0.0)));
`,

  /** Light quantised into four steps. Cel shading. */
  stepped: `
  float t = clamp(max(dot(nrm, KEY), 0.0) * 4.0, 0.0, 3.999);
  float k0 = floor(t);
  float k1 = min(k0 + 1.0, 3.0);
  vec3 b0 = c1 * 0.3;
  vec3 b1 = c2;
  vec3 b2 = mix(c2, c1, 0.6);
  vec3 b3 = c1;
  vec3 s0 = mix(mix(mix(b0, b1, step(0.5, k0)), b2, step(1.5, k0)), b3, step(2.5, k0));
  vec3 s1 = mix(mix(mix(b0, b1, step(0.5, k1)), b2, step(1.5, k1)), b3, step(2.5, k1));
  return mix(s0, s1, smoothstep(0.0, 0.2, fract(t)));
`,

  /** Printed in dots. The shading is the dot size. */
  halftone: `
  float n = max(dot(nrm, KEY), 0.0);
  float cell = 6.0;
  float d = length(mod(gl_FragCoord.xy, cell) - 0.5 * cell);
  return mix(c2, c1, step(d, mix(cell * 0.48, cell * 0.1, n)));
`,

  /** Inked silhouette around a soft fill. */
  outlined: `
  vec3 base = c1 * (0.3 + 0.7 * max(dot(nrm, KEY), 0.0));
  return mix(base, c1 * 0.1, smoothstep(0.2, 0.55, fres));
`,
}
