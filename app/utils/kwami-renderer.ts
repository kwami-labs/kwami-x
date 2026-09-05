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

const VERTEX = `
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

void main() {
  // Two octaves: a slow swell that reads as breathing, plus a faster ripple
  // that only shows up when the Kwami is speaking or agitated.
  float slow = snoise(normal * uFrequency + uTime * 0.22);
  float fast = snoise(normal * uFrequency * 2.7 - uTime * 0.65);

  // A dying Kwami deflates rather than changing colour alone — the silhouette
  // is what a player reads at a glance in a grid of thirty.
  float life = mix(0.45, 1.0, uVitality);
  float displace = (slow * 0.7 + fast * 0.3 * (0.25 + uAudio)) * uAmplitude * life;
  displace += uAudio * 0.22 + uArousal * 0.08;

  vDisplace = displace;
  vNormal = normalize(normalMatrix * normal);

  vec3 displaced = position + normal * displace;
  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}
`

const FRAGMENT = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uRimPower;
uniform float uVitality;
uniform float uAudio;

varying vec3 vNormal;
varying vec3 vViewDir;
varying float vDisplace;

void main() {
  float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), uRimPower);

  // Colour tracks displacement, so the surface reads as depth rather than a
  // flat gradient rolling over a sphere.
  vec3 base = mix(uColorA, uColorB, clamp(vDisplace * 1.6 + 0.5, 0.0, 1.0));

  // Desaturate towards grey as vitality drops. A dead Kwami is visibly ash.
  float grey = dot(base, vec3(0.299, 0.587, 0.114));
  base = mix(vec3(grey * 0.55), base, uVitality);

  vec3 rim = mix(uColorB, vec3(1.0), 0.35) * fresnel * (0.6 + uAudio * 0.8) * uVitality;
  gl_FragColor = vec4(base * 0.55 + rim, 1.0);
}
`

export interface KwamiRendererOptions {
  renderer?: KwamiRenderer
  colorA?: string
  colorB?: string
  /** 0 = dead, 1 = at its high-water mark. */
  vitality?: number
}

export interface KwamiRendererHandle {
  /** Live audio level in [0, 1]; smoothed internally. */
  setAudioLevel(level: number): void
  /** 0 = idle, 1 = agitated. Raised while the Kwami speaks or the clock is short. */
  setArousal(value: number): void
  setVitality(value: number): void
  setColors(a: string, b: string): void
  resize(): void
  dispose(): void
}

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
  const preset = RENDERER_PRESETS[options.renderer ?? 'blob-xyz']

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
    uAmplitude: { value: preset.amplitude },
    uFrequency: { value: preset.frequency },
    uAudio: { value: 0 },
    uArousal: { value: 0 },
    uVitality: { value: options.vitality ?? 1 },
    uRimPower: { value: preset.rimPower },
    uColorA: { value: new Color(options.colorA ?? '#7c5cff') },
    uColorB: { value: new Color(options.colorB ?? '#3ddc97') },
  }

  const material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms })

  const mesh = new Mesh(new IcosahedronGeometry(1, preset.detail), material)
  scene.add(mesh)

  let sparks: Points | null = null
  if (preset.particles > 0) {
    const positions = new Float32Array(preset.particles * 3)
    for (let i = 0; i < preset.particles; i++) {
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
        color: new Color(options.colorB ?? '#3ddc97'),
        transparent: true,
        opacity: 0.7,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    )
    scene.add(sparks)
  }

  let audioTarget = 0
  let audioSmoothed = 0
  let arousal = 0
  let raf = 0
  let disposed = false
  const clockStart = performance.now()
  let lastFrame = clockStart

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

    // Attack fast, release slow: speech onsets should snap, but the surface
    // should not flicker in the gaps between syllables.
    const rate = audioTarget > audioSmoothed ? 18 : 4
    audioSmoothed += (audioTarget - audioSmoothed) * Math.min(1, dt * rate)

    uniforms.uTime.value = (now - clockStart) / 1000
    uniforms.uAudio.value = audioSmoothed
    uniforms.uArousal.value = arousal

    mesh.rotation.y += dt * preset.spin
    mesh.rotation.x = Math.sin((now - clockStart) / 6000) * 0.14
    if (sparks) sparks.rotation.y -= dt * preset.spin * 0.4

    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }

  resize()
  raf = requestAnimationFrame(frame)

  const onResize = () => resize()
  window.addEventListener('resize', onResize)

  return {
    setAudioLevel(level) {
      audioTarget = Math.max(0, Math.min(1, level)) * preset.reactivity
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
