/**
 * The Kwami avatar renderer.
 *
 * A single displaced icosphere with a fresnel rim, driven by three inputs:
 * the live microphone/agent audio level, an arousal value the game sets, and
 * the Kwami's vitality. Written directly against Three.js rather than pulled
 * from the `kwami` package because this build also has to run inside a
 * third-party embed, where every extra kilobyte is someone else's page weight.
 *
 * The five renderer names are the same five the rest of the platform uses;
 * they are parameter sets over one shader, not five separate pipelines, which
 * is what keeps a Kwami's look consistent between the arena, the card grid and
 * an embed on a stranger's site.
 */
import {
  Color,
  IcosahedronGeometry,
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
} from 'three'
import type { KwamiRenderer } from '#shared/types/kwami'

export interface RendererParams {
  /** Base displacement amplitude. */
  amplitude: number
  /** Noise frequency — high values read as "crystalline", low as "liquid". */
  frequency: number
  /** How hard audio pushes the surface. */
  reactivity: number
  /** Rotation speed, radians per second. */
  spin: number
  /** Rim light power; higher is a tighter, brighter edge. */
  rimPower: number
  /** Geometry subdivision. Higher is smoother and more expensive. */
  detail: number
  /** Sparks orbiting the core. */
  particles: number
}

export const RENDERER_PRESETS: Record<KwamiRenderer, RendererParams> = {
  'blob-xyz': {
    amplitude: 0.34,
    frequency: 1.4,
    reactivity: 0.9,
    spin: 0.16,
    rimPower: 2.4,
    detail: 5,
    particles: 0,
  },
  'crystal-ball': {
    amplitude: 0.1,
    frequency: 3.4,
    reactivity: 0.45,
    spin: 0.1,
    rimPower: 4.2,
    detail: 4,
    particles: 120,
  },
  'orbital-shards': {
    amplitude: 0.52,
    frequency: 2.1,
    reactivity: 1.3,
    spin: 0.34,
    rimPower: 1.8,
    detail: 3,
    particles: 260,
  },
  'stars-genesis': {
    amplitude: 0.2,
    frequency: 0.9,
    reactivity: 0.7,
    spin: 0.06,
    rimPower: 3,
    detail: 5,
    particles: 700,
  },
  'black-hole': {
    amplitude: 0.07,
    frequency: 5,
    reactivity: 0.3,
    spin: 0.5,
    rimPower: 6,
    detail: 5,
    particles: 340,
  },
}

/**
 * Classic 3D simplex noise, inlined into the vertex shader.
 *
 * Pulled in as source rather than computed on the CPU because displacing a
 * 5-subdivision icosphere is ~10k vertices per frame — trivial on the GPU,
 * a dropped frame budget in JavaScript.
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

varying vec3 vNormal;
varying vec3 vViewDir;
varying float vDisplace;

${SIMPLEX}

/**
 * How far the surface is pushed out along a given direction on the sphere.
 *
 * Factored out of main so the normal can be derived from it. Two octaves: a
 * slow swell that reads as breathing, plus a faster ripple that only shows up
 * when the Kwami is speaking or agitated.
 */
float displaceAt(vec3 dir, float life) {
  float slow = snoise(dir * uFrequency + uTime * 0.22);
  float fast = snoise(dir * uFrequency * 2.7 - uTime * 0.65);
  float d = (slow * 0.7 + fast * 0.3 * (0.25 + uAudio)) * uAmplitude * life;
  return d + uAudio * 0.22 + uArousal * 0.08;
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
   * Pushing vertices along the sphere's normal leaves the shading normal
   * describing a shape that is no longer there: every crest and trough the
   * geometry actually has becomes invisible, and the Kwami reads as a flat
   * gradient rolling over a ball. Recovering it in the fragment shader with
   * dFdx/dFdy is worse — screen-space derivatives of an interpolated position
   * give the *face* normal, so the whole thing turns into visible triangles.
   *
   * Instead, evaluate the same noise at two nearby points on the sphere and
   * take the cross product of the resulting edges. Six extra noise samples per
   * vertex, and the surface finally catches light the way its silhouette says
   * it should.
   */
  // Any vector not parallel to dir works as a seed; the pole is the one place
  // the obvious choice degenerates, so it is swapped out there.
  vec3 seed = abs(dir.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 tangent = normalize(cross(seed, dir));
  vec3 bitangent = cross(dir, tangent);

  float eps = 0.035;
  vec3 dirT = normalize(dir + tangent * eps);
  vec3 dirB = normalize(dir + bitangent * eps);

  vec3 p0 = dir * (1.0 + displace);
  vec3 pT = dirT * (1.0 + displaceAt(dirT, life));
  vec3 pB = dirB * (1.0 + displaceAt(dirB, life));

  vec3 displacedNormal = normalize(cross(pT - p0, pB - p0));
  // The cross product's sign depends on the tangent frame's handedness, which
  // flips across the sphere. Align it outwards so lighting is not inverted on
  // half the surface.
  if (dot(displacedNormal, dir) < 0.0) displacedNormal = -displacedNormal;

  vNormal = normalize(normalMatrix * displacedNormal);

  vec4 mvPosition = modelViewMatrix * vec4(p0, 1.0);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}
`

export const KWAMI_FRAGMENT_SHADER = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uRimPower;
uniform float uVitality;
uniform float uAudio;

varying vec3 vNormal;
varying vec3 vViewDir;
varying float vDisplace;

/** Key light, in view space. Over the shoulder and slightly above. */
const vec3 KEY = vec3(0.45, 0.72, 0.55);
/** A cool fill from below, so the unlit side is shadow rather than a hole. */
const vec3 FILL = vec3(-0.4, -0.5, 0.3);

void main() {
  vec3 n = normalize(vNormal);
  vec3 view = normalize(vViewDir);

  float fresnel = pow(1.0 - max(dot(n, view), 0.0), uRimPower);

  // Wrapped diffuse rather than plain Lambert: a hard terminator on a small
  // dark object reads as a crescent moon, not as a creature.
  float key = max(dot(n, normalize(KEY)) * 0.5 + 0.5, 0.0);
  float fill = max(dot(n, normalize(FILL)) * 0.5 + 0.5, 0.0);

  // A tight specular gives the surface a wet, alive quality — without it the
  // whole thing reads as chalk no matter how bright the diffuse is.
  vec3 halfVector = normalize(normalize(KEY) + view);
  float spec = pow(max(dot(n, halfVector), 0.0), 38.0);

  // Colour tracks displacement, so the surface reads as depth rather than a
  // flat gradient rolling over a sphere.
  vec3 base = mix(uColorA, uColorB, clamp(vDisplace * 1.6 + 0.5, 0.0, 1.0));

  // Desaturate towards grey as vitality drops. A dead Kwami is visibly ash.
  float grey = dot(base, vec3(0.299, 0.587, 0.114));
  base = mix(vec3(grey * 0.55), base, uVitality);

  vec3 lit = base * (0.26 + 0.95 * key * key) + base * uColorA * 0.3 * fill;
  vec3 rim = mix(uColorB, vec3(1.0), 0.35) * fresnel * (0.8 + uAudio * 0.9) * uVitality;

  vec3 color = lit + rim + vec3(spec) * (0.4 + uAudio * 0.5) * uVitality;

  // Filmic-ish rolloff. The rim and the specular both overshoot 1.0 on a
  // saturated palette, and clipping them turns a coloured highlight white.
  color = color / (color + vec3(0.9));
  // Undo the rolloff's overall darkening without reintroducing the clipping —
  // the shoulder is there to tame highlights, not to mute the midtones.
  color = pow(color, vec3(0.85)) * 1.12;

  gl_FragColor = vec4(color, 1.0);
}
`

export interface KwamiRendererOptions {
  renderer?: KwamiRenderer
  colorA?: string
  colorB?: string
  /** 0 = dead, 1 = at its high-water mark. */
  vitality?: number
  /** Creator overrides on top of the body's preset. */
  tuning?: Partial<RendererParams>
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
  setColors(a: string, b: string): void
  /** Move to another body. Tweens the continuous parameters; swaps the rest. */
  setRenderer(renderer: KwamiRenderer): void
  /** Apply creator overrides on top of the current body's preset. */
  setTuning(tuning: Partial<RendererParams>): void
  setActivity(activity: KwamiActivity): void
  resize(): void
  dispose(): void
}

/** How fast a parameter change catches up, per second. ~400ms to settle. */
const TWEEN_RATE = 6

/** The parameters that can be eased rather than swapped. */
type LiveParams = Pick<RendererParams, 'amplitude' | 'frequency' | 'reactivity' | 'spin' | 'rimPower'>

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
  let tuning: Partial<RendererParams> = { ...options.tuning }

  /**
   * The parameters being aimed at: the body's preset with the creator's
   * overrides laid on top.
   *
   * Kept as a derivation rather than a stored snapshot so that changing the
   * body keeps the overrides, and clearing an override falls back to whatever
   * the preset says today rather than to a copy of what it said at mount.
   */
  function resolve(): RendererParams {
    return { ...RENDERER_PRESETS[body], ...tuning }
  }

  let target = resolve()
  const live: LiveParams = {
    amplitude: target.amplitude,
    frequency: target.frequency,
    reactivity: target.reactivity,
    spin: target.spin,
    rimPower: target.rimPower,
  }

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
  const uniforms = {
    uTime: { value: 0 },
    uAmplitude: { value: live.amplitude },
    uFrequency: { value: live.frequency },
    uAudio: { value: 0 },
    uArousal: { value: 0 },
    uVitality: { value: options.vitality ?? 1 },
    uRimPower: { value: live.rimPower },
    uColorA: { value: new Color(options.colorA ?? '#7c5cff') },
    uColorB: { value: new Color(options.colorB ?? '#3ddc97') },
  }

  const material = new ShaderMaterial({
    vertexShader: KWAMI_VERTEX_SHADER,
    fragmentShader: KWAMI_FRAGMENT_SHADER,
    uniforms,
  })

  const mesh = new Mesh(new IcosahedronGeometry(1, target.detail), material)
  scene.add(mesh)
  let detail = target.detail

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

  /** Swap the mesh's subdivision. Only when it actually changed — it is a realloc. */
  function applyDetail(next: number) {
    if (next === detail) return
    detail = next
    mesh.geometry.dispose()
    mesh.geometry = new IcosahedronGeometry(1, next)
  }

  /** Re-derive the target and apply anything that cannot be eased into place. */
  function retarget() {
    const previous = target
    target = resolve()
    applyDetail(target.detail)
    if (target.particles !== previous.particles) applyParticles(target.particles)
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

  function resize() {
    const parent = canvas.parentElement
    if (!parent) return
    const { clientWidth: w, clientHeight: h } = parent
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
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
    live.amplitude += (target.amplitude - live.amplitude) * ease
    live.frequency += (target.frequency - live.frequency) * ease
    live.reactivity += (target.reactivity - live.reactivity) * ease
    live.spin += (target.spin - live.spin) * ease
    live.rimPower += (target.rimPower - live.rimPower) * ease

    uniforms.uTime.value = elapsed / 1000
    uniforms.uAudio.value = audioSmoothed
    uniforms.uArousal.value = Math.min(1, arousal + activityArousal(elapsed))
    uniforms.uAmplitude.value = live.amplitude
    uniforms.uFrequency.value = live.frequency
    uniforms.uRimPower.value = live.rimPower

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
    setColors(a, b) {
      uniforms.uColorA.value.set(a)
      uniforms.uColorB.value.set(b)
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
