/**
 * The Kwami avatar renderer.
 *
 * A displaced sphere wearing one of twenty-two skins, driven by four inputs:
 * the live microphone/agent audio level, an arousal value the game sets, the
 * Kwami's vitality, and whatever the creator tuned at mint. Written directly
 * against Three.js rather than pulled from the `kwami` package because this
 * build also has to run inside a third-party embed, where every extra kilobyte
 * is someone else's page weight.
 *
 * The five renderer names are the same five the rest of the platform uses;
 * they are parameter sets over one shader, not five separate pipelines, which
 * is what keeps a Kwami's look consistent between the arena, the card grid and
 * an embed on a stranger's site. The skin is orthogonal to all five.
 *
 * Two things here are load-bearing and easy to lose:
 *
 *  1. **The displacement is on the GPU, and its normal is analytic.** Pushing
 *     vertices out along a sphere's own normal and shading with that normal
 *     describes a shape that is not there; the Kwami reads as a flat gradient
 *     rolling over a ball. The vertex shader samples the same noise at two
 *     nearby points and crosses the edges instead.
 *
 *  2. **Colour is managed end to end.** Three converts a hex string into
 *     linear light when it reaches a uniform, and a `ShaderMaterial` that
 *     writes its result straight to `gl_FragColor` hands those linear numbers
 *     to an sRGB framebuffer untouched. Every Kwami came out muddy and about a
 *     stop dark, which no amount of tuning the lighting could fix, because the
 *     lighting was never the problem. `main` tone-maps and then encodes.
 */
import {
  Color,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  AdditiveBlending,
  BufferGeometry,
  BufferAttribute,
  Points,
  PointsMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import type { KwamiRenderer, KwamiSkin } from '#shared/types/kwami'
import type { KwamiTuning } from '#shared/kwami/appearance'
import { DEFAULT_SKIN } from '#shared/kwami/skins'
import { KWAMI_SKIN_BODIES, KWAMI_SKIN_PRELUDE } from './kwami-skins'

/**
 * Everything the shader reads, resolved.
 *
 * Structurally `KwamiTuning`, and deliberately so: the creator's sliders are
 * the renderer's parameters, with no translation layer in between that could
 * expose a control for a uniform the shader does not have.
 */
export type RendererParams = KwamiTuning

/** The neutral per-axis values. A Kwami with all three equal is isotropic. */
const AXIS_NEUTRAL = {
  spikeX: 1,
  spikeY: 1,
  spikeZ: 1,
  ampX: 1,
  ampY: 1,
  ampZ: 1,
  timeX: 1,
  timeY: 1,
  timeZ: 1,
} as const

/** What every body shares unless it says otherwise. */
const COMMON = {
  ...AXIS_NEUTRAL,
  breathing: 0.035,
  shininess: 50,
  opacity: 1,
  lightIntensity: 0,
  resolution: 180,
} as const

/**
 * The five bodies.
 *
 * Retuned away from the old numbers, which produced a permanently lumpy
 * potato: the frequency was high enough that the noise completed several
 * cycles across the sphere, and the amplitude was large enough that the lumps
 * never resolved into a silhouette. A blob at rest should be *nearly* a
 * sphere — smooth, swelling, alive — and break into spikes when it speaks.
 * That is what the audio term is for, and the old defaults spent the whole
 * budget before a word was said.
 */
export const RENDERER_PRESETS: Record<KwamiRenderer, RendererParams> = {
  'blob-xyz': {
    ...COMMON,
    amplitude: 0.22,
    frequency: 0.9,
    reactivity: 1.8,
    spin: 0.16,
    rimPower: 2.4,
    particles: 0,
  },
  'crystal-ball': {
    ...COMMON,
    amplitude: 0.07,
    frequency: 2.6,
    reactivity: 0.9,
    spin: 0.1,
    rimPower: 4.2,
    particles: 120,
    shininess: 130,
  },
  'orbital-shards': {
    ...COMMON,
    amplitude: 0.46,
    frequency: 2.1,
    reactivity: 2.2,
    spin: 0.34,
    rimPower: 1.8,
    particles: 260,
    resolution: 160,
    // Unequal axes are what makes shards read as fractured rather than as a
    // louder blob: the ridges run around the body instead of boiling evenly.
    spikeY: 1.8,
    ampZ: 1.4,
  },
  'stars-genesis': {
    ...COMMON,
    amplitude: 0.14,
    frequency: 0.6,
    reactivity: 1.2,
    spin: 0.06,
    rimPower: 3,
    particles: 700,
    lightIntensity: 0.5,
  },
  'black-hole': {
    ...COMMON,
    amplitude: 0.05,
    frequency: 4.4,
    reactivity: 0.6,
    spin: 0.5,
    rimPower: 6,
    particles: 340,
    resolution: 200,
    shininess: 20,
  },
}

/**
 * Classic 3D simplex noise, inlined into both shaders.
 *
 * Pulled in as source rather than computed on the CPU because displacing a
 * subdivided icosphere is tens of thousands of vertices per frame — trivial on
 * the GPU, a dropped frame budget in JavaScript. The desktop app does it on
 * the CPU and pays for it with a hard ceiling on mesh resolution; doing it here
 * is what lets the mesh be smooth enough that the silhouette is not the thing
 * giving the Kwami away.
 */
const SIMPLEX = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`

export const KWAMI_VERTEX_SHADER = `
uniform float uTime;
uniform float uAmplitude;
uniform float uFrequency;
uniform float uAudio;
uniform float uArousal;
uniform float uVitality;
uniform float uBreathing;
uniform vec3 uSpike;
uniform vec3 uAmp;
uniform vec3 uTimeScale;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vPos;
varying float vDisplace;

${SIMPLEX}

/**
 * How far the surface is pushed out along a given direction on the sphere.
 *
 * Factored out of main so the normal can be derived from it. Three terms:
 *
 *  - a slow swell, plus a faster ripple on top, which together read as
 *    breathing rather than as vibration;
 *  - an audio term whose *frequency* rises with the level, so a loud syllable
 *    grows new spikes instead of merely inflating the ones already there —
 *    inflation alone is indistinguishable from the Kwami getting bigger;
 *  - a uniform breath, which is the one thing that must never be zero. A
 *    perfectly still Kwami reads as a crashed tab.
 *
 * The per-axis weights are what make a blob a creature. uSpike scales the
 * noise frequency per axis, so pulling one down stretches the features into
 * ridges that run around the body; uAmp weights how far each axis travels,
 * by the direction's own components, so the two compose rather than fight.
 */
float displaceAt(vec3 dir, float life) {
  vec3 freq = uFrequency * uSpike;
  vec3 clock = uTime * uTimeScale * 0.34;
  float ampMul = abs(dir.x) * uAmp.x + abs(dir.y) * uAmp.y + abs(dir.z) * uAmp.z;

  float slow = snoise(dir * freq + clock);
  float fast = snoise(dir * freq * 2.1 - clock * 1.6);
  // Weighted well towards the slow octave. An even split creases the surface
  // into tinfoil, which is texture rather than shape — and shape is the only
  // thing a player reads at card size.
  float idle = slow * 0.8 + fast * 0.2;

  float boost = 1.0 + uAudio * 2.4;
  float spike = snoise(dir * freq * boost * 1.7 + clock * 1.8);

  float d = uAmplitude * ampMul * (idle + spike * uAudio * 1.5) * life;
  return d + uBreathing * sin(uTime * 1.6) + uAudio * 0.14 + uArousal * 0.06;
}

void main() {
  // A dying Kwami deflates rather than changing colour alone — the silhouette
  // is what a player reads at a glance in a grid of thirty.
  float life = mix(0.45, 1.0, uVitality);

  vec3 dir = normalize(normal);
  float displace = displaceAt(dir, life);
  vDisplace = displace;

  /**
   * The normal of the *displaced* surface, sampled analytically.
   *
   * Recovering it in the fragment shader with dFdx/dFdy is worse than useless:
   * screen-space derivatives of an interpolated position give the *face*
   * normal, so the whole thing turns into visible triangles. Evaluating the
   * same noise at two nearby points and crossing the resulting edges costs six
   * extra samples per vertex and gives a surface that catches light the way
   * its silhouette says it should.
   */
  // Any vector not parallel to dir works as a seed; the pole is the one place
  // the obvious choice degenerates, so it is swapped out there.
  vec3 seed = abs(dir.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 tangent = normalize(cross(seed, dir));
  vec3 bitangent = cross(dir, tangent);

  float eps = 0.03;
  vec3 dirT = normalize(dir + tangent * eps);
  vec3 dirB = normalize(dir + bitangent * eps);

  vec3 p0 = dir * (1.0 + displace);
  vec3 pT = dirT * (1.0 + displaceAt(dirT, life));
  vec3 pB = dirB * (1.0 + displaceAt(dirB, life));

  // Guarded rather than normalised blind: where the two sampled edges are very
  // nearly parallel the cross product is a zero vector, and normalizing it
  // gives NaN — one black pixel-wide scratch across an otherwise clean surface,
  // in a place that moves every frame.
  vec3 raw = cross(pT - p0, pB - p0);
  float rawLength = length(raw);
  vec3 displacedNormal = rawLength > 1e-7 ? raw / rawLength : dir;
  // The cross product's sign depends on the tangent frame's handedness, which
  // flips across the sphere. Align it outwards so lighting is not inverted on
  // half the surface.
  if (dot(displacedNormal, dir) < 0.0) displacedNormal = -displacedNormal;

  vNormal = normalize(normalMatrix * displacedNormal);
  vPos = p0;

  vec4 mvPosition = modelViewMatrix * vec4(p0, 1.0);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}
`

/**
 * Everything the fragment shader needs before a skin body can run.
 *
 * The globals are set once in `main` and read by the skin, rather than passed
 * as eight arguments to every one of twenty-two functions. It keeps each skin
 * to the four to twenty lines that are actually about that material.
 */
const FRAGMENT_HEAD = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uRimPower;
uniform float uVitality;
uniform float uAudio;
uniform float uTime;
uniform float uShininess;
uniform float uOpacity;
uniform float uLightIntensity;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vPos;
varying float vDisplace;

${SIMPLEX}

vec3 nrm;
vec3 vw;
vec3 pos;
vec3 c1;
vec3 c2;
vec3 c3;
float shiny;
float specPow;
float specAmt;
float fres;
float skinAlpha;

${KWAMI_SKIN_PRELUDE}

/**
 * ACES filmic, the cheap fit.
 *
 * A rim light and a specular both overshoot 1.0 on a saturated palette, and
 * clipping them turns a coloured highlight white — which is exactly what makes
 * a bright Kwami look like a cheap render. The shoulder keeps the hue.
 */
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

/** Linear light to sRGB. The uniforms are linear; the framebuffer is not. */
vec3 encodeSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055, step(0.0031308, c));
}
`

const FRAGMENT_MAIN = `
void main() {
  nrm = normalize(vNormal);
  vw = normalize(vViewDir);
  pos = vPos;
  shiny = uShininess;
  specPow = max(1.0, uShininess);
  // Divided by more than the slider's own range. The exponent and the weight
  // both come off one number, so a mid shininess that gives a believable
  // exponent gives a weight that paints a white patch over every crest — the
  // highlight has to stay a highlight rather than becoming the surface.
  specAmt = uShininess / 420.0;
  fres = 1.0 - max(dot(nrm, vw), 0.0);
  skinAlpha = 1.0;

  // Desaturate towards ash as vitality drops, before the skin runs rather than
  // after: a metallic Kwami's colour lives in its reflection, so bleaching the
  // finished pixel would leave a dead Kwami still shining in full colour.
  float grey = dot(uColorA, vec3(0.299, 0.587, 0.114));
  c1 = mix(vec3(grey * 0.55), uColorA, uVitality);
  c2 = mix(vec3(grey * 0.55), uColorB, uVitality);
  c3 = mix(vec3(grey * 0.55), uColorC, uVitality);

  vec3 color = kwamiSurface();

  // The rim is shared across every skin rather than left to each one. It is
  // what separates a dark Kwami from a dark page, and a catalogue where two
  // thirds of the entries vanish against the background is a catalogue where
  // two thirds of the entries are not really choices.
  float rim = pow(fres, uRimPower);
  color += mix(c2, vec3(1.0), 0.15) * rim * (0.22 + uAudio * 0.6) * uVitality;

  // Colour tracks displacement, so a crest reads as nearer rather than as the
  // same surface at a different angle.
  color *= 1.0 + clamp(vDisplace, -0.5, 0.5) * 0.16;

  if (uLightIntensity > 0.0) {
    float lift = clamp(uLightIntensity / 2.5, 0.0, 3.0);
    color += color * (0.4 + rim * 0.6) * lift;
  }

  gl_FragColor = vec4(encodeSRGB(aces(color)), uOpacity * skinAlpha);
}
`

/**
 * Assemble the fragment shader for one skin.
 *
 * Exported because the background field builds its own materials from the same
 * source — a Kwami drifting behind the sign-in panel has to be recognisably
 * the same object the arena shows a second later.
 */
export function buildKwamiFragmentShader(skin: KwamiSkin = DEFAULT_SKIN): string {
  const body = KWAMI_SKIN_BODIES[skin] ?? KWAMI_SKIN_BODIES[DEFAULT_SKIN]
  return `${FRAGMENT_HEAD}\nvec3 kwamiSurface() {\n${body}\n}\n${FRAGMENT_MAIN}`
}

/** The default skin's program, for callers that never change skin. */
export const KWAMI_FRAGMENT_SHADER = buildKwamiFragmentShader(DEFAULT_SKIN)

/**
 * A complete uniform set.
 *
 * One factory rather than an object literal at each call site: the shader has
 * eighteen uniforms, and a caller that forgets one gets a silently black Kwami
 * rather than an error.
 */
export function createKwamiUniforms(
  params: RendererParams,
  colors: { a: string; b: string; c: string },
  vitality = 1,
) {
  return {
    uTime: { value: 0 },
    uAmplitude: { value: params.amplitude },
    uFrequency: { value: params.frequency },
    uAudio: { value: 0 },
    uArousal: { value: 0 },
    uVitality: { value: vitality },
    uBreathing: { value: params.breathing },
    uRimPower: { value: params.rimPower },
    uShininess: { value: params.shininess },
    uOpacity: { value: params.opacity },
    uLightIntensity: { value: params.lightIntensity },
    uSpike: { value: new Vector3(params.spikeX, params.spikeY, params.spikeZ) },
    uAmp: { value: new Vector3(params.ampX, params.ampY, params.ampZ) },
    uTimeScale: { value: new Vector3(params.timeX, params.timeY, params.timeZ) },
    uColorA: { value: new Color(colors.a) },
    uColorB: { value: new Color(colors.b) },
    uColorC: { value: new Color(colors.c) },
  }
}

/**
 * The sphere the creator's resolution setting asks for.
 *
 * `resolution` is segments around the equator, the same number and the same
 * range the desktop app uses, so 180 means the same mesh in both.
 *
 * This used to be an icosphere at "detail 5", on the belief that detail is a
 * subdivision *depth*. It is not: three's `PolyhedronGeometry` splits each of
 * the twenty faces into `(detail + 1)²` triangles, so detail 5 is 720
 * triangles, not the ~20k the old comment claimed. Every Kwami on the platform
 * was drawn on a mesh two orders of magnitude coarser than intended, which is
 * why they had visibly straight edges around the silhouette and read as carved
 * rocks rather than as anything liquid. At 180 segments this is ~37k
 * triangles, and the outline is finally a curve.
 *
 * A UV sphere rather than a merged icosphere despite the seam and the poles:
 * the normal is derived analytically in the vertex shader from each vertex's
 * own direction, and duplicated seam vertices share that direction exactly, so
 * they displace and shade identically. The seam that would need
 * `mergeVertices` under `computeVertexNormals` simply is not there. The sphere
 * is also indexed, so 37k triangles cost 16k vertex shader invocations rather
 * than the 110k an equivalent non-indexed icosphere would.
 */
export function segmentsForResolution(resolution: number): { width: number; height: number } {
  const width = Math.max(48, Math.min(256, Math.round(resolution / 2) * 2))
  return { width, height: Math.max(24, Math.round(width / 2)) }
}

/** The mesh for a resolution. Shared with the background field. */
export function createKwamiGeometry(resolution: number): SphereGeometry {
  const { width, height } = segmentsForResolution(resolution)
  return new SphereGeometry(1, width, height)
}

export interface KwamiRendererOptions {
  renderer?: KwamiRenderer
  skin?: KwamiSkin
  colorA?: string
  colorB?: string
  colorC?: string
  /** 0 = dead, 1 = at its high-water mark. */
  vitality?: number
  /** Creator overrides on top of the body's preset. */
  tuning?: Partial<RendererParams>
  /**
   * A ceiling on the creator's mesh resolution, for small renders.
   *
   * A Kwami in a card grid is 180 pixels across and one of a dozen live WebGL
   * contexts on the page. It cannot tell the difference between a 37k-triangle
   * mesh and a 9k one, and the page very much can. The creator's setting is
   * still what is minted and what the profile page draws — this only says how
   * much of it is worth paying for *here*.
   */
  resolutionCap?: number
}

/**
 * What the Kwami is doing.
 *
 * The renderer drives these itself rather than taking a raw arousal number for
 * each, because the interesting one is `thinking`: a reply takes a second or
 * two to arrive, and a Kwami that holds perfectly still through it reads as
 * having crashed. `docs/builder.md` makes the same point about the streaming
 * builder — a spinner cannot be told apart from a hang — and the fix is the
 * same, which is to keep something moving that is visibly *waiting*.
 */
export type KwamiActivity = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface KwamiRendererHandle {
  /** Live audio level in [0, 1]; smoothed internally. */
  setAudioLevel(level: number): void
  /** 0 = idle, 1 = agitated. Raised while the Kwami speaks or the clock is short. */
  setArousal(value: number): void
  setVitality(value: number): void
  setColors(a: string, b: string, c: string): void
  /** Move to another body. Tweens the continuous parameters; swaps the rest. */
  setRenderer(renderer: KwamiRenderer): void
  /** Change the surface material. Recompiles one program. */
  setSkin(skin: KwamiSkin): void
  /** Apply creator overrides on top of the current body's preset. */
  setTuning(tuning: Partial<RendererParams>): void
  setActivity(activity: KwamiActivity): void
  resize(): void
  dispose(): void
}

/** How fast a parameter change catches up, per second. ~400ms to settle. */
const TWEEN_RATE = 6

/**
 * The parameters a body and a set of overrides add up to.
 *
 * Pulled out of the render loop so it can be tested without a WebGL context —
 * this is the whole of the logic behind "switching body changes the Kwami", and
 * leaving it inside a closure that only runs against a real GPU meant the one
 * thing worth asserting was the one thing unreachable from a test.
 *
 * A derivation rather than a stored snapshot: changing body keeps the
 * creator's overrides, and clearing an override falls back to whatever the
 * preset says *today* rather than to a copy of what it said at mount.
 */
export function resolveRendererParams(
  renderer: KwamiRenderer,
  tuning: Partial<RendererParams> = {},
): RendererParams {
  const preset = RENDERER_PRESETS[renderer] ?? RENDERER_PRESETS['blob-xyz']
  const resolved = { ...preset }
  for (const [key, value] of Object.entries(tuning)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    resolved[key as keyof RendererParams] = value
  }
  return resolved
}

/** The parameters that can be eased rather than swapped. */
const LIVE_KEYS = [
  'amplitude',
  'frequency',
  'reactivity',
  'spin',
  'rimPower',
  'breathing',
  'shininess',
  'opacity',
  'lightIntensity',
  'spikeX',
  'spikeY',
  'spikeZ',
  'ampX',
  'ampY',
  'ampZ',
  'timeX',
  'timeY',
  'timeZ',
] as const

type LiveParams = Record<(typeof LIVE_KEYS)[number], number>

/**
 * Mount a Kwami into a canvas.
 *
 * Returns a handle rather than a reactive object on purpose: this runs at 60fps
 * and pushing every audio frame through Vue's reactivity would schedule a
 * component update per frame for values only the GPU ever reads.
 */
export function mountKwami(
  canvas: HTMLCanvasElement,
  options: KwamiRendererOptions = {},
): KwamiRendererHandle {
  let body: KwamiRenderer = options.renderer ?? 'blob-xyz'
  let skin: KwamiSkin = options.skin ?? DEFAULT_SKIN
  let tuning: Partial<RendererParams> = { ...options.tuning }

  let target = resolveRendererParams(body, tuning)
  const live = Object.fromEntries(LIVE_KEYS.map((k) => [k, target[k]])) as LiveParams

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  // Capping at 2 rather than using the raw ratio: a 3x phone display gains
  // nothing visible here and costs a third of the frame budget.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new Scene()
  const camera = new PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 0, 4.2)

  // Uniform objects are captured by reference below, so the render loop mutates
  // them directly instead of indexing `material.uniforms` sixty times a second.
  const uniforms = createKwamiUniforms(
    target,
    {
      a: options.colorA ?? '#7c5cff',
      b: options.colorB ?? '#3ddc97',
      c: options.colorC ?? '#ff5cb8',
    },
    options.vitality ?? 1,
  )

  /**
   * Build the material for the current skin.
   *
   * Transparency is decided here rather than left on permanently: a
   * transparent material writes no depth, and a Kwami that does not write
   * depth renders its own far side through its near side. Only the skins that
   * are genuinely see-through pay for that.
   */
  function createMaterial(): ShaderMaterial {
    const translucent = uniforms.uOpacity.value < 0.999 || skin === 'fresnel' || skin === 'hologram'
    return new ShaderMaterial({
      vertexShader: KWAMI_VERTEX_SHADER,
      fragmentShader: buildKwamiFragmentShader(skin),
      uniforms,
      transparent: translucent,
      depthWrite: !translucent,
    })
  }

  const resolutionCap = options.resolutionCap ?? Number.POSITIVE_INFINITY
  const cappedResolution = (value: number) => Math.min(value, resolutionCap)

  let material = createMaterial()
  let resolution = cappedResolution(target.resolution)
  const mesh = new Mesh(createKwamiGeometry(resolution), material)
  scene.add(mesh)

  let sparks: Points | null = null
  let sparkColor = options.colorB ?? '#3ddc97'

  /**
   * Rebuild the orbiting cloud.
   *
   * Discrete rather than tweened: the count is a buffer length, and there is no
   * halfway between 120 particles and 260. Disposing and rebuilding is cheap
   * because it is a single position attribute, and it only happens when the
   * creator actually changes body or particle density.
   */
  function applyParticles(count: number) {
    if (sparks) {
      scene.remove(sparks)
      sparks.geometry.dispose()
      ;(sparks.material as PointsMaterial).dispose()
      sparks = null
    }
    const total = Math.max(0, Math.round(count))
    if (total === 0) return

    const positions = new Float32Array(total * 3)
    for (let i = 0; i < total; i++) {
      // Rejection-free spherical shell sampling: uniform on the sphere, then
      // jittered outwards so the cloud has depth instead of reading as a ring.
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = 1.5 + Math.random() * 1.3
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    sparks = new Points(
      geo,
      new PointsMaterial({
        size: 0.02,
        color: new Color(sparkColor),
        transparent: true,
        opacity: 0.7,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    )
    scene.add(sparks)
  }

  applyParticles(target.particles)

  /** Swap the mesh. Only when the resolution actually changed — it is a realloc. */
  function applyResolution(requested: number) {
    const next = cappedResolution(requested)
    if (segmentsForResolution(next).width === segmentsForResolution(resolution).width) return
    resolution = next
    mesh.geometry.dispose()
    mesh.geometry = createKwamiGeometry(next)
  }

  /** Swap the program. Only when the skin changed — it is a shader compile. */
  function applySkin() {
    const next = createMaterial()
    material.dispose()
    material = next
    mesh.material = next
  }

  /** Re-derive the target and apply anything that cannot be eased into place. */
  function retarget() {
    const previous = target
    target = resolveRendererParams(body, tuning)
    applyResolution(target.resolution)
    if (target.particles !== previous.particles) applyParticles(target.particles)
    // Opacity crossing 1 flips the material between depth-writing and not,
    // which the uniform alone cannot express.
    const wasOpaque = previous.opacity >= 0.999
    if (wasOpaque !== target.opacity >= 0.999) applySkin()
  }

  let audioTarget = 0
  let audioSmoothed = 0
  let arousal = 0
  let activity: KwamiActivity = 'idle'
  let raf = 0
  let disposed = false
  const clockStart = performance.now()
  let lastFrame = clockStart

  /**
   * The movement the Kwami generates on its own, on top of what the game asks for.
   *
   * `thinking` is the one that matters and the one that is deliberately a
   * *pulse*: a constant lift would just be a slightly bigger Kwami, which is
   * indistinguishable from a frozen one. It has to visibly move to read as
   * working rather than hung.
   */
  function activityArousal(elapsed: number): number {
    switch (activity) {
      case 'listening':
        return 0.18
      case 'thinking':
        return 0.36 + Math.sin(elapsed / 260) * 0.22
      case 'speaking':
        return 0.24
      default:
        return 0
    }
  }

  /**
   * Pull the camera back far enough that the whole Kwami is in frame.
   *
   * `camera.fov` is the *vertical* field of view, so a fixed camera distance
   * only frames the Kwami correctly at the one aspect ratio it was chosen for.
   * Anything portrait — the mint stage, a phone, an embed in a sidebar — kept
   * the same vertical framing while the horizontal field narrowed with the
   * width, and the Kwami was cropped off both sides. What was left on screen
   * was a magnified patch of one hemisphere: no silhouette, no rim, and a
   * single colour out of a palette of three, which reads as a low-quality
   * render rather than as a cropped one.
   *
   * Fitting to whichever axis is tighter costs two tangents on a resize and
   * makes the framing a property of the Kwami rather than of the container.
   */
  function resize() {
    const parent = canvas.parentElement
    if (!parent) return
    const { clientWidth: w, clientHeight: h } = parent
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // Unit sphere plus the largest displacement any preset reaches, plus the
    // rim light, which is part of the silhouette and is not worth clipping.
    const radius = 1.6
    const half = Math.tan((camera.fov * Math.PI) / 360)
    camera.position.z = Math.max(radius / half, radius / (half * camera.aspect))
    camera.updateProjectionMatrix()
  }

  function frame(now: number) {
    if (disposed) return
    const dt = Math.min((now - lastFrame) / 1000, 0.1)
    lastFrame = now
    const elapsed = now - clockStart

    // Attack fast, release slow: speech onsets should snap, but the surface
    // should not flicker in the gaps between syllables.
    const rate = audioTarget > audioSmoothed ? 18 : 4
    audioSmoothed += (audioTarget - audioSmoothed) * Math.min(1, dt * rate)

    // Ease towards the current body rather than snapping to it. Switching body
    // is a design decision the creator is making with their eyes, and watching
    // the Kwami *become* the thing they picked is most of what tells them the
    // click worked.
    const ease = Math.min(1, dt * TWEEN_RATE)
    for (const key of LIVE_KEYS) live[key] += (target[key] - live[key]) * ease

    uniforms.uTime.value = elapsed / 1000
    uniforms.uAudio.value = audioSmoothed
    uniforms.uArousal.value = Math.min(1, arousal + activityArousal(elapsed))
    uniforms.uAmplitude.value = live.amplitude
    uniforms.uFrequency.value = live.frequency
    uniforms.uRimPower.value = live.rimPower
    uniforms.uBreathing.value = live.breathing
    uniforms.uShininess.value = live.shininess
    uniforms.uOpacity.value = live.opacity
    uniforms.uLightIntensity.value = live.lightIntensity
    uniforms.uSpike.value.set(live.spikeX, live.spikeY, live.spikeZ)
    uniforms.uAmp.value.set(live.ampX, live.ampY, live.ampZ)
    uniforms.uTimeScale.value.set(live.timeX, live.timeY, live.timeZ)

    mesh.rotation.y += dt * live.spin
    mesh.rotation.x = Math.sin(elapsed / 6000) * 0.14
    if (sparks) sparks.rotation.y -= dt * live.spin * 0.4

    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }

  resize()
  raf = requestAnimationFrame(frame)

  const onResize = () => resize()
  window.addEventListener('resize', onResize)

  return {
    setAudioLevel(level) {
      audioTarget = Math.max(0, Math.min(1, level)) * live.reactivity
    },
    setArousal(value) {
      arousal = Math.max(0, Math.min(1, value))
    },
    setVitality(value) {
      uniforms.uVitality.value = Math.max(0, Math.min(1, value))
    },
    setColors(a, b, c) {
      uniforms.uColorA.value.set(a)
      uniforms.uColorB.value.set(b)
      uniforms.uColorC.value.set(c)
      // The cloud is a separate material and does not read the uniforms, so it
      // used to keep whatever colour it was built with — a creator changing the
      // rim colour saw four of the five bodies keep their old sparks.
      sparkColor = b
      if (sparks) (sparks.material as PointsMaterial).color.set(b)
    },
    setRenderer(next) {
      if (next === body) return
      body = next
      retarget()
    },
    setSkin(next) {
      if (next === skin) return
      skin = next
      applySkin()
    },
    setTuning(next) {
      tuning = { ...next }
      retarget()
    },
    setActivity(next) {
      activity = next
    },
    resize,
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      mesh.geometry.dispose()
      material.dispose()
      sparks?.geometry.dispose()
      ;(sparks?.material as PointsMaterial | undefined)?.dispose()
      renderer.dispose()
    },
  }
}
