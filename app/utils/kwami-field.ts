/**
 * A drifting field of Kwamis, used as a live background.
 *
 * This is not a grid of `KwamiAvatar`s. Each avatar owns a `WebGLRenderer`, and
 * browsers cap the number of live WebGL contexts per page at around sixteen —
 * past that they start silently killing the oldest ones, so a background of two
 * dozen Kwamis would blank out the ones the page is actually about. Everything
 * here lives in one context: one renderer, one scene, one draw call per Kwami.
 *
 * The shader is the same one `kwami-renderer` uses for a single Kwami, so a
 * Kwami in the background of the sign-in screen is recognisably the same object
 * the arena will show a second later.
 */
import {
  Color,
  IcosahedronGeometry,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three'
import { paletteFromMint } from '#shared/kwami/appearance'
import { KWAMI_FRAGMENT_SHADER, KWAMI_VERTEX_SHADER } from './kwami-renderer'

export interface KwamiFieldOptions {
  /** How many Kwamis drift in the field. */
  count?: number
  /** Seeds that fix each Kwami's palette — mints, names, anything stable. */
  seeds?: string[]
  /** Drift speed multiplier. Below 1 the field reads as ambient rather than busy. */
  tempo?: number
}

export interface KwamiFieldHandle {
  resize(): void
  dispose(): void
}

interface Drifter {
  mesh: Mesh
  uniforms: Record<string, { value: number | Color }>
  /** Radians per second around the field's centre. */
  orbit: number
  /** Where this Kwami sits in its own bob cycle, so they do not pulse in unison. */
  phase: number
  /** Position on the ring, as a fraction of the visible half-extent at its depth. */
  spreadX: number
  spreadY: number
  /** How far it wanders from that anchor, in world units. */
  wander: number
  depth: number
  scale: number
}

/** The app's own hue derivation, so the background Kwamis are drawn from the
 *  same palette space as the real ones the arena is about to show. */
function paletteFrom(seed: string): [Color, Color] {
  const { a, b } = paletteFromMint(seed)
  return [new Color(a), new Color(b)]
}

export function mountKwamiField(
  canvas: HTMLCanvasElement,
  options: KwamiFieldOptions = {},
): KwamiFieldHandle {
  const seeds = options.seeds?.length ? options.seeds : DEFAULT_SEEDS
  const count = Math.min(options.count ?? 9, seeds.length)
  const tempo = options.tempo ?? 1

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' })
  // A background is never the thing being looked at. Capping at 1.5 rather than
  // the avatar's 2 buys back a third of the fill cost for a difference nobody
  // notices behind a blurred glass panel.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))

  const scene = new Scene()
  const camera = new PerspectiveCamera(52, 1, 0.1, 140)
  camera.position.set(0, 0, 13)

  // One geometry for the whole field. Subdivision 4 rather than the avatar's 5:
  // 3 is visibly faceted once a Kwami is large enough to read as a shape — it
  // looks like a rock rather than something alive — and 5 is 40k vertices per
  // Kwami for a silhouette difference nobody can see behind a blurred panel.
  const geometry = new IcosahedronGeometry(1, 4)

  const drifters: Drifter[] = []

  for (let i = 0; i < count; i++) {
    const seed = seeds[i]!
    const [colorA, colorB] = paletteFrom(seed)

    // Golden-angle placement: successive Kwamis land as far from their
    // predecessors as the circle allows, so nine of them never clump.
    const angle = i * 2.399963
    const uniforms = {
      uTime: { value: Math.random() * 100 },
      uAmplitude: { value: 0.26 + (i % 3) * 0.07 },
      uFrequency: { value: 1.2 + (i % 4) * 0.5 },
      uAudio: { value: 0 },
      uArousal: { value: 0 },
      uVitality: { value: 1 },
      uRimPower: { value: 2.2 + (i % 3) * 0.6 },
      uColorA: { value: colorA },
      uColorB: { value: colorB },
    }

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader: KWAMI_VERTEX_SHADER,
        fragmentShader: KWAMI_FRAGMENT_SHADER,
        uniforms,
        transparent: true,
      }),
    )

    const depth = -4 - (i % 4) * 5

    // Placed on a ring around the centre rather than scattered across it. The
    // middle of this background is where a modal sits, so a Kwami placed there
    // is a Kwami nobody sees — and the ones that peek out from behind the panel
    // edge read as clutter rather than as a scene. A ring frames the panel.
    //
    // The radius is a fraction of the *visible* extent at that Kwami's depth,
    // resolved at layout time, so the ring widens with the window instead of
    // leaving Kwamis stranded mid-screen on a wide monitor.
    const ringRadius = 0.62 + (i % 3) * 0.16
    const drifter: Drifter = {
      mesh,
      uniforms,
      orbit: (0.03 + (i % 5) * 0.008) * (i % 2 === 0 ? 1 : -1) * tempo,
      phase: angle,
      spreadX: Math.cos(angle) * ringRadius,
      spreadY: Math.sin(angle) * ringRadius * 0.82,
      wander: 0.5 + (i % 3) * 0.35,
      depth,
      // Further Kwamis are smaller, which is the only depth cue a flat
      // background gets — the camera's perspective alone is too weak at this
      // field of view to separate them.
      scale: 1.5 + (i % 3) * 0.55 + depth * 0.06,
    }
    drifter.mesh.scale.setScalar(drifter.scale)
    drifters.push(drifter)
    scene.add(mesh)
  }

  let raf = 0
  let disposed = false
  const start = performance.now()
  let last = start

  /** World half-height visible at a given z, for the current camera. */
  function halfHeightAt(z: number): number {
    const distance = camera.position.z - z
    return Math.tan((camera.fov * Math.PI) / 360) * distance
  }

  function resize() {
    const parent = canvas.parentElement
    if (!parent) return
    const { clientWidth: w, clientHeight: h } = parent
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()

    for (const d of drifters) {
      const halfHeight = halfHeightAt(d.depth)
      d.mesh.userData.anchorX = d.spreadX * halfHeight * camera.aspect
      d.mesh.userData.anchorY = d.spreadY * halfHeight
    }
  }

  function frame(now: number) {
    if (disposed) return
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    const t = (now - start) / 1000

    for (const d of drifters) {
      d.uniforms.uTime!.value = (d.uniforms.uTime!.value as number) + dt
      // A slow breath in the displacement amplitude. Without it the field is
      // technically animated but visually static — the rotation alone reads as
      // a screensaver rather than something alive.
      d.uniforms.uArousal!.value = 0.12 + Math.sin(t * 0.4 + d.phase) * 0.1

      // Drift around the anchor rather than orbiting the origin: the ring has
      // to stay a ring, or after a minute every Kwami has migrated back into
      // the middle of the screen where the panel is.
      const a = d.phase + t * d.orbit * 6
      d.mesh.position.set(
        (d.mesh.userData.anchorX as number) + Math.cos(a) * d.wander,
        (d.mesh.userData.anchorY as number) + Math.sin(a * 0.8 + d.phase) * d.wander,
        d.depth,
      )
      d.mesh.rotation.y += dt * 0.18
      d.mesh.rotation.x = Math.sin(t * 0.2 + d.phase) * 0.2
    }

    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }

  resize()
  raf = requestAnimationFrame(frame)

  const onResize = () => resize()
  window.addEventListener('resize', onResize)

  // A background must not keep a GPU busy behind a hidden tab — on a laptop
  // that is a fan spinning up for pixels nobody can see.
  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf)
    } else if (!disposed) {
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  return {
    resize,
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const d of drifters) (d.mesh.material as ShaderMaterial).dispose()
      geometry.dispose()
      renderer.dispose()
    },
  }
}

/**
 * Fallback seeds.
 *
 * The sign-in screen renders before any Kwami has been fetched — it is what
 * gates the fetch — so the field needs palettes that do not depend on data. The
 * strings are arbitrary; only their hashes matter.
 */
const DEFAULT_SEEDS = [
  'the moon remembers',
  'orbit',
  'a quiet vault',
  'nine of swords',
  'salt and static',
  'a door in the floor',
  'hollow bell',
  'the long count',
  'amber signal',
  'first light',
  'second wind',
  'null island',
]
