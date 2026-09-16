import { describe, expect, it } from 'vitest'
import {
  KWAMI_FRAME_RADIUS,
  KWAMI_VERTEX_SHADER,
  PITCH_LIMIT,
  RENDERER_PRESETS,
  TOUCH_DURATION_MS,
  TOUCH_POINTS,
  TOUCH_RADIUS,
  TOUCH_SMOOTHING,
  ZOOM_LIMITS,
  buildKwamiFragmentShader,
  cameraDistanceFor,
  clampZoom,
  resolveRendererParams,
  segmentsForResolution,
  touchEase,
  touchSettle,
  zoomAfterWheel,
} from '~/utils/kwami-renderer'
import { KWAMI_SKINS, tuningForSkin } from '#shared/kwami/skins'
import { lookFor } from '~/utils/format'
import { TUNING_RANGES, readTuning, toAppearance } from '#shared/kwami/appearance'
import { KWAMI_LOOKS } from '#shared/kwami/looks'
import type { KwamiRenderer } from '#shared/types/kwami'

const NAMES: KwamiRenderer[] = ['blob-xyz', 'crystal-ball', 'orbital-shards', 'stars-genesis', 'black-hole']

describe('renderer presets', () => {
  it('covers every renderer the domain declares', () => {
    // A missing preset would fall through to `undefined` and crash on mount,
    // which is a strange way to discover that a Kwami has an unknown form.
    for (const name of NAMES) {
      expect(RENDERER_PRESETS[name]).toBeDefined()
    }
    expect(Object.keys(RENDERER_PRESETS).sort()).toEqual([...NAMES].sort())
  })

  it('keeps every parameter inside a sane range', () => {
    for (const [name, preset] of Object.entries(RENDERER_PRESETS)) {
      expect(preset.amplitude, name).toBeGreaterThan(0)
      expect(preset.amplitude, name).toBeLessThan(1)
      expect(preset.particles, name).toBeGreaterThanOrEqual(0)
      expect(preset.rimPower, name).toBeGreaterThan(0)
      expect(preset.opacity, name).toBeGreaterThan(0)
      // The mesh has to be fine enough that the silhouette is a curve and
      // coarse enough that a mid-range phone holds 60fps with several cards on
      // screen. The resolution slider is the only thing that can reach it.
      expect(segmentsForResolution(preset.resolution).width, name).toBeGreaterThanOrEqual(96)
      expect(segmentsForResolution(preset.resolution).width, name).toBeLessThanOrEqual(256)
    }
  })

  it('opens on a blob that is nearly a sphere', () => {
    // The bug this exists for: the old defaults put the whole displacement
    // budget into the resting shape, so every Kwami was a lumpy potato before
    // a word was said and the audio term had nothing left to express. A blob
    // at rest should read as a smooth, swelling ball.
    const blob = RENDERER_PRESETS['blob-xyz']
    expect(blob.amplitude).toBeLessThan(0.3)
    // Under one full cycle of noise across the sphere, so the surface reads as
    // one swelling shape rather than as boiling.
    expect(blob.frequency).toBeLessThan(1.2)
    // And it is never completely still, which is what separates alive from
    // crashed.
    expect(blob.breathing).toBeGreaterThan(0)
  })

  it('gives each renderer a distinguishable silhouette', () => {
    const signatures = Object.values(RENDERER_PRESETS).map(
      (p) => `${p.amplitude}:${p.frequency}:${p.particles}`,
    )
    expect(new Set(signatures).size).toBe(signatures.length)
  })
})

describe('tuning ranges', () => {
  it('names only parameters the renderer actually has', () => {
    // `TUNING_RANGES` lives in `shared/` and the presets live in `app/`, so
    // nothing but this test stops a slider being added for a uniform the
    // shader does not read — it would move, and the Kwami would not.
    const params = Object.keys(RENDERER_PRESETS['blob-xyz'])
    for (const key of Object.keys(TUNING_RANGES)) {
      expect(params, key).toContain(key)
    }
  })

  it('contains every preset inside the slider it will be edited with', () => {
    // Opening "Fine tune" on a body whose preset sits outside its own track
    // shows a slider pinned to one end, and the first drag silently snaps the
    // Kwami to a value nobody chose. Either the range is wrong or the preset
    // is; both are bugs, and this is where they surface.
    for (const [name, preset] of Object.entries(RENDERER_PRESETS)) {
      for (const [key, range] of Object.entries(TUNING_RANGES)) {
        const value = preset[key as keyof typeof preset]
        expect(value, `${name}.${key}`).toBeGreaterThanOrEqual(range.min)
        expect(value, `${name}.${key}`).toBeLessThanOrEqual(range.max)
      }
    }
  })

  it('reads a stored override back as the renderer would apply it', () => {
    // The round trip the studio depends on: what `toAppearance` writes at mint
    // is what `readTuning` hands the renderer on the profile page.
    const stored = toAppearance({ a: '#7c5cff', b: '#3ddc97' }, { spin: 0.4, particles: 300 })
    expect(readTuning(stored)).toEqual({ spin: 0.4, particles: 300 })
  })
})

describe('resolveRendererParams', () => {
  it('gives back the body preset when nothing is tuned', () => {
    for (const name of NAMES) {
      expect(resolveRendererParams(name)).toEqual(RENDERER_PRESETS[name])
    }
  })

  it('changes every parameter when the body changes', () => {
    // The bug this exists for: the preview was read once at mount and never
    // again, so clicking a different body updated the label and left the mesh
    // exactly as it was. Switching has to actually move the numbers.
    const blob = resolveRendererParams('blob-xyz')
    const hole = resolveRendererParams('black-hole')
    expect(hole.amplitude).not.toBe(blob.amplitude)
    expect(hole.frequency).not.toBe(blob.frequency)
    expect(hole.particles).not.toBe(blob.particles)
  })

  it('lays the creator overrides on top of the preset', () => {
    const tuned = resolveRendererParams('blob-xyz', { spin: 0.5 })
    expect(tuned.spin).toBe(0.5)
    // Untouched parameters still come from the preset, not from a default.
    expect(tuned.amplitude).toBe(RENDERER_PRESETS['blob-xyz'].amplitude)
  })

  it('carries overrides across a body change', () => {
    // Someone who slowed their Kwami down and then tried a different body meant
    // to keep it slow; silently restoring the preset's spin would undo a
    // deliberate choice on an unrelated click.
    const tuning = { spin: 0.5 }
    expect(resolveRendererParams('crystal-ball', tuning).spin).toBe(0.5)
    expect(resolveRendererParams('stars-genesis', tuning).spin).toBe(0.5)
  })

  it('ignores junk rather than poisoning a uniform with it', () => {
    // NaN in `uAmplitude` does not throw — it renders nothing at all, which is
    // a very hard failure to trace back to a slider.
    const params = resolveRendererParams('blob-xyz', {
      amplitude: Number.NaN,
      frequency: undefined as unknown as number,
    })
    expect(params.amplitude).toBe(RENDERER_PRESETS['blob-xyz'].amplitude)
    expect(params.frequency).toBe(RENDERER_PRESETS['blob-xyz'].frequency)
  })

  it('falls back to a real body for an unknown name', () => {
    // A Kwami minted with a renderer this build does not know must still
    // render something rather than crashing on an undefined preset.
    expect(resolveRendererParams('not-a-body' as never)).toEqual(RENDERER_PRESETS['blob-xyz'])
  })

  it('applies a look end to end, from the table to the uniforms', () => {
    for (const look of KWAMI_LOOKS) {
      const params = resolveRendererParams(look.renderer, look.tuning)
      for (const [key, value] of Object.entries(look.tuning)) {
        expect(params[key as keyof typeof params], `${look.id}.${key}`).toBe(value)
      }
    }
  })
})

describe('skins', () => {
  it('compiles a distinct program for every skin in the catalogue', () => {
    // A missing body would silently fall back to the default surface, so a
    // creator picking `chrome` would get `radial` with no error anywhere.
    const programs = new Set<string>()
    for (const skin of KWAMI_SKINS) {
      const source = buildKwamiFragmentShader(skin.id)
      expect(source, skin.id).toContain('vec3 kwamiSurface()')
      programs.add(source)
    }
    expect(programs.size).toBe(KWAMI_SKINS.length)
  })

  it('declares every varying the vertex shader hands over', () => {
    // The two shaders are written apart and linked at runtime, where a
    // mismatch is a console warning inside a WebGL context nobody is watching.
    const source = buildKwamiFragmentShader('marble')
    for (const declaration of [
      'varying vec3 vNormal',
      'varying vec3 vViewDir',
      'varying vec3 vPos',
      'varying float vDisplace',
    ]) {
      expect(source, declaration).toContain(declaration)
      expect(KWAMI_VERTEX_SHADER, declaration).toContain(declaration)
    }
  })

  it('encodes its output rather than writing linear light to an sRGB buffer', () => {
    // The whole reason every Kwami used to look muddy and a stop dark. Three
    // converts a hex uniform into linear light and does not convert back for a
    // ShaderMaterial, so the shader has to.
    const source = buildKwamiFragmentShader('radial')
    expect(source).toContain('encodeSRGB')
    expect(source).toContain('aces(')
    expect(source).toMatch(/gl_FragColor\s*=\s*vec4\(encodeSRGB\(aces\(color\)\)/)
  })

  it('lands each skin on its own material defaults', () => {
    // Picking `chrome` at `matte`'s shininess is a grey ball, which reads as
    // the skin being broken rather than as a slider being wrong.
    for (const skin of KWAMI_SKINS) {
      const tuning = tuningForSkin(skin.id)
      expect(tuning.shininess, skin.id).toBe(skin.shininess)
      expect(tuning.opacity, skin.id).toBe(skin.opacity)
    }
    expect(tuningForSkin('chrome').shininess).toBeGreaterThan(tuningForSkin('matte').shininess)
  })
})

describe('cameraDistanceFor', () => {
  /** Half the extent the Kwami projects to, in NDC, on each axis. 1.0 is the edge. */
  function projected(aspect: number) {
    const fov = 45
    const z = cameraDistanceFor(fov, aspect)
    const halfHeight = Math.tan((fov * Math.PI) / 360) * z
    return { y: KWAMI_FRAME_RADIUS / halfHeight, x: KWAMI_FRAME_RADIUS / (halfHeight * aspect) }
  }

  it('keeps the whole Kwami on screen at any shape of container', () => {
    // The bug: a fixed camera distance frames to the *vertical* field of view,
    // so the mint stage (tall and narrow), a phone and a sidebar embed all
    // cropped the Kwami off both sides and showed a magnified patch of one
    // hemisphere — no silhouette, one colour out of three.
    // The tighter axis lands exactly on the edge, so the bound carries a float
    // epsilon rather than pretending two tangents round-trip exactly.
    for (const aspect of [0.4, 0.53, 0.75, 1, 1.6, 2.4]) {
      const { x, y } = projected(aspect)
      expect(x, `aspect ${aspect}`).toBeLessThanOrEqual(1 + 1e-9)
      expect(y, `aspect ${aspect}`).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('fills the frame rather than fitting a circle inside a margin', () => {
    // Fitting is only half of it: a camera that always fell back to the widest
    // case would frame every Kwami as a speck. The tighter axis has to touch.
    for (const aspect of [0.4, 1, 2.4]) {
      const { x, y } = projected(aspect)
      expect(Math.max(x, y), `aspect ${aspect}`).toBeCloseTo(1, 5)
    }
  })

  it('pulls back for a portrait container and not for a landscape one', () => {
    expect(cameraDistanceFor(45, 0.5)).toBeGreaterThan(cameraDistanceFor(45, 1))
    expect(cameraDistanceFor(45, 2)).toBe(cameraDistanceFor(45, 1))
  })
})

describe('skin surfaces', () => {
  const MATERIALS = ['matte', 'glossy', 'metallic', 'subsurface', 'chrome', 'clay', 'jade'] as const

  it('shades off the light rather than off a matcap that is not there', () => {
    // What made half the catalogue look identical: these skins read `nrm.xy` as
    // a lookup into a matcap texture that does not exist. It only ever worked
    // by accident on a smooth sphere — on a displaced blob the normal's z sits
    // near 1 across most of the visible surface, so the lookup collapsed to a
    // constant and chrome, jade, clay and toon all rendered as the same flat
    // wash of the creator's first colour.
    for (const skin of [...MATERIALS, 'toon-matcap' as const]) {
      expect(buildKwamiFragmentShader(skin), skin).not.toContain('nrm.xy * 0.5 + 0.5')
    }
  })

  it('reads the displacement the vertex shader went to the trouble of sending', () => {
    // `vDisplace` is the only thing the fragment shader cannot work out for
    // itself, and darkening the creases with it is most of what stops a
    // displaced sphere reading as a ball with a gradient painted on it.
    for (const skin of MATERIALS) {
      expect(buildKwamiFragmentShader(skin), skin).toContain('cavity()')
    }
  })

  it('gives the reflective skins an environment to reflect', () => {
    for (const skin of ['chrome', 'metallic', 'glossy'] as const) {
      expect(buildKwamiFragmentShader(skin), skin).toContain('envSample(')
    }
  })

  it('closes every skin body, so one stray backtick cannot swallow the next', () => {
    // These are GLSL inside template literals. A backtick in a comment ends the
    // string, and the failure lands as a parse error in a file nobody was
    // editing — or worse, as a shader that silently compiles to nothing.
    for (const skin of KWAMI_SKINS) {
      const source = buildKwamiFragmentShader(skin.id)
      expect(source, skin.id).not.toContain('`')
      // A body that lost its tail would still contain the wrapper.
      expect(source.trim().endsWith('}'), skin.id).toBe(true)
    }
  })
})

describe('lookFor', () => {
  it('reads back everything the studio wrote, not only the colours', () => {
    // The bug this exists for: the card, the profile, the play stage and the
    // embed each resolved the palette and dropped the skin and the tuning. A
    // creator could spend ten minutes choosing a chrome surface with a slow
    // spin, mint it, and land on a profile page showing the default blob — the
    // appearance was stored correctly and read back nowhere but the studio.
    const stored = toAppearance(
      { a: '#7c5cff', b: '#3ddc97', c: '#ff5cb8' },
      { spin: 0.05, shininess: 180 },
      'chrome',
    )
    const look = lookFor({ mint: 'Kw1Ora1', appearance: stored })
    expect(look.skin).toBe('chrome')
    expect(look.tuning).toEqual({ spin: 0.05, shininess: 180 })
    expect(look.palette).toEqual({ a: '#7c5cff', b: '#3ddc97', c: '#ff5cb8' })
  })

  it('degrades each part on its own', () => {
    // An unknown skin is a surface this build cannot compile, and the right
    // answer is the default surface with the creator's real colours — not a
    // fallback palette as well.
    const look = lookFor({
      mint: 'Kw1Ora1',
      appearance: { colorA: '#ff0000', colorB: '#00ff00', skin: 'obsidian' },
    })
    expect(look.skin).toBe('radial')
    expect(look.palette.a).toBe('#ff0000')
  })

  it('gives a Kwami with no stored appearance a complete look anyway', () => {
    const look = lookFor({ mint: 'Kw3Shr111111111111111111111111111111111111111' })
    expect(look.skin).toBe('radial')
    expect(look.tuning).toEqual({})
    expect(Object.values(look.palette).every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
  })
})

describe('segmentsForResolution', () => {
  it('rises with the slider and never leaves the affordable range', () => {
    const widths = [120, 140, 170, 200, 220].map((r) => segmentsForResolution(r).width)
    expect(widths).toEqual([...widths].sort((a, b) => a - b))
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(48)
    expect(Math.max(...widths)).toBeLessThanOrEqual(256)
  })

  it('gives a mesh fine enough that the silhouette is a curve', () => {
    // The bug this exists for: three's PolyhedronGeometry `detail` splits each
    // face into (detail + 1)² triangles rather than subdividing recursively, so
    // the icosphere this replaced was 720 triangles where the code believed it
    // was 20,000. Every Kwami had visibly straight edges around its outline.
    const { width, height } = segmentsForResolution(RENDERER_PRESETS['blob-xyz'].resolution)
    expect(width * height * 2).toBeGreaterThan(10_000)
  })

  it('always produces an even ring, so the seam closes on a vertex', () => {
    for (const resolution of [120, 137, 180, 199, 220]) {
      expect(segmentsForResolution(resolution).width % 2, String(resolution)).toBe(0)
    }
  })
})

describe('zoomAfterWheel', () => {
  it('pushes in on a scroll up and pulls out on a scroll down', () => {
    expect(zoomAfterWheel(1, -100)).toBeGreaterThan(1)
    expect(zoomAfterWheel(1, 100)).toBeLessThan(1)
  })

  it('stops at both ends rather than running away', () => {
    // Past the far stop the Kwami is a bead in an empty panel and past the near
    // one the silhouette — the thing being chosen — is off screen entirely.
    let out = 1
    let inward = 1
    for (let i = 0; i < 200; i++) {
      out = zoomAfterWheel(out, 400)
      inward = zoomAfterWheel(inward, -400)
    }
    expect(out).toBe(ZOOM_LIMITS.min)
    expect(inward).toBe(ZOOM_LIMITS.max)
  })

  it('reports the stop by not moving, so the page can have the scroll back', () => {
    // What stops a reader being trapped on the stage: the component only
    // swallows the wheel event while the zoom still has somewhere to go.
    expect(zoomAfterWheel(ZOOM_LIMITS.max, -100)).toBe(ZOOM_LIMITS.max)
    expect(zoomAfterWheel(ZOOM_LIMITS.min, 100)).toBe(ZOOM_LIMITS.min)
  })

  it('reads a line-mode wheel as further than a pixel-mode one', () => {
    // Firefox reports three *lines* where Chrome reports a hundred pixels.
    // Treating them as the same number makes a real mouse wheel feel dead.
    expect(zoomAfterWheel(1, 3, 1)).toBeLessThan(zoomAfterWheel(1, 3, 0))
    expect(zoomAfterWheel(1, 1, 2)).toBeLessThan(zoomAfterWheel(1, 1, 1))
  })

  it('caps one event, so a trackpad burst cannot cross the whole range', () => {
    // A single inertial flick can report several hundred pixels; one event that
    // jumped from one stop to the other would read as a bug rather than a zoom.
    expect(zoomAfterWheel(1, 20_000)).toBeGreaterThan(ZOOM_LIMITS.min)
    expect(zoomAfterWheel(1, -20_000)).toBeLessThan(ZOOM_LIMITS.max)
  })

  it('means the same proportion wherever it is applied', () => {
    // Multiplicative rather than additive: an additive step is a crawl when the
    // camera is far out and a lurch when it is close in.
    const near = zoomAfterWheel(0.8, -40) / 0.8
    const far = zoomAfterWheel(1.6, -40) / 1.6
    expect(near).toBeCloseTo(far, 10)
  })

  it('survives the junk a wheel event can actually carry', () => {
    // A non-finite zoom is a broken camera, and the only safe recovery is the
    // framing the stage mounted with — clamping infinity to the near stop would
    // leave the creator inside their own Kwami with no idea why.
    expect(zoomAfterWheel(1, Number.NaN)).toBe(1)
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampZoom(3)).toBe(ZOOM_LIMITS.max)
    expect(clampZoom(0.01)).toBe(ZOOM_LIMITS.min)
  })
})

describe('touchEase', () => {
  it('does nothing before the press and nothing after it', () => {
    expect(touchEase(0)).toBe(0)
    expect(touchEase(1)).toBe(0)
    expect(touchEase(1.4)).toBe(0)
    expect(touchEase(-0.2)).toBe(0)
    expect(touchEase(Number.NaN)).toBe(0)
  })

  it('lands the dent a quarter of the way in and takes the rest to let go', () => {
    // The asymmetry is the whole feel of it: a press that eases in and out
    // evenly reads as an animation playing rather than as something soft being
    // pushed. Quarter in, three quarters out.
    expect(touchEase(0.25)).toBeCloseTo(1, 12)
    expect(touchEase(0.125)).toBeCloseTo(0.25, 12)
    expect(touchEase(0.625)).toBeCloseTo(0.875, 12)
  })

  it('joins up where the two halves meet', () => {
    // Both branches are 1 at a quarter. A step here is a visible jolt at the
    // deepest point of every single press.
    expect(touchEase(0.24999)).toBeCloseTo(touchEase(0.25001), 3)
  })

  it('rises to the dent and then falls away, without ever going backwards', () => {
    const rising = [0.05, 0.1, 0.15, 0.2, 0.25].map(touchEase)
    expect(rising).toEqual([...rising].sort((a, b) => a - b))
    const falling = [0.3, 0.5, 0.7, 0.9, 0.99].map(touchEase)
    expect(falling).toEqual([...falling].sort((a, b) => b - a))
  })

  it('is never deeper than the press that caused it', () => {
    for (let p = 0; p <= 1; p += 0.01) {
      expect(touchEase(p), String(p)).toBeGreaterThanOrEqual(0)
      expect(touchEase(p), String(p)).toBeLessThanOrEqual(1)
    }
  })
})

describe('the touch in the vertex shader', () => {
  it('dents the surface where it was pressed and rings out from there', () => {
    // The library does this per vertex on the CPU; this build displaces on the
    // GPU, so the same arithmetic has to be in the shader or a press does
    // nothing at all. These are the terms it is made of.
    expect(KWAMI_VERTEX_SHADER).toContain('float touchAt(vec3 dir)')
    expect(KWAMI_VERTEX_SHADER).toContain('uniform vec4 uTouch[KWAMI_TOUCHES]')
    expect(KWAMI_VERTEX_SHADER).toContain('uniform vec2 uTouchDrive[KWAMI_TOUCHES]')
    // The sink, and the ripple travelling out behind it.
    expect(KWAMI_VERTEX_SHADER).toContain('-uTouchDrive[i].y * 0.42 * reach')
    expect(KWAMI_VERTEX_SHADER).toContain('sin(dist * 2.4 - uTouchDrive[i].x * 5.4) * 0.24 * reach')
  })

  it('carries the constants the renderer schedules the press with', () => {
    // Two copies of 2.1 — one in TypeScript deciding how far a press reaches
    // and one in GLSL applying it — is a drift waiting to happen, so the shader
    // is written from the constant.
    expect(KWAMI_VERTEX_SHADER).toContain(`#define KWAMI_TOUCHES ${TOUCH_POINTS}`)
    expect(KWAMI_VERTEX_SHADER).toContain(`const float KWAMI_TOUCH_RADIUS = ${TOUCH_RADIUS.toFixed(4)};`)
    // GLSL has no implicit int-to-float, so a radius that ever became a round
    // number would stop the entire shader compiling — every Kwami on the
    // platform, over a constant nobody would think to look at.
    expect(KWAMI_VERTEX_SHADER).toMatch(/KWAMI_TOUCH_RADIUS = \d+\.\d+;/)
  })

  it('runs the press through the same displacement the audio uses', () => {
    // Not added to the position afterwards: the normal is derived by sampling
    // `displaceAt` either side of each vertex, so a dent applied outside it
    // would be a hollow that still catches light as though it were round.
    expect(KWAMI_VERTEX_SHADER).toContain('+ touchAt(dir)')
    expect(KWAMI_VERTEX_SHADER).toContain('clamp(1.0 + shaped, 0.55, 1.45)')
  })

  it('keeps a press to a shape a Kwami can hold', () => {
    // A dent that reaches past the middle turns the surface inside out on the
    // way through, and the Kwami lights from within for a frame.
    expect(KWAMI_VERTEX_SHADER).toContain('clamp(total, -0.7, 0.5)')
  })
})

describe('touchSettle', () => {
  it("is the library's own quarter-per-frame at the frame rate it assumed", () => {
    expect(touchSettle(1 / 60)).toBeCloseTo(TOUCH_SMOOTHING, 12)
  })

  it('closes the same distance in the same time at any frame rate', () => {
    // The bug this exists for is the one a flat per-frame constant always has:
    // the same 0.25 is a surface arriving two and a half times faster on a
    // 144Hz display than on the 60Hz one it was tuned against.
    function settled(dt: number, seconds: number) {
      let gap = 1
      const frames = Math.round(seconds / dt)
      for (let i = 0; i < frames; i++) gap -= gap * touchSettle(dt)
      return 1 - gap
    }
    // A tenth of a second is a whole number of frames at every rate here, so
    // any difference is the rate compensation being wrong rather than the last
    // partial frame landing in a different place.
    const reference = settled(1 / 60, 0.1)
    for (const dt of [1 / 20, 1 / 50, 1 / 100, 1 / 200]) {
      expect(settled(dt, 0.1), String(dt)).toBeCloseTo(reference, 9)
    }
  })

  it('never overshoots the target, however long the frame', () => {
    // A dropped frame must not send the surface past where it was going and
    // back — a stall would show up as the Kwami flinching.
    for (const dt of [0.001, 1 / 60, 0.1, 1, 30]) {
      expect(touchSettle(dt), String(dt)).toBeGreaterThan(0)
      expect(touchSettle(dt), String(dt)).toBeLessThanOrEqual(1)
    }
    expect(touchSettle(0)).toBe(0)
    expect(touchSettle(Number.NaN)).toBe(0)
  })

  it('leaves the press still coming back after its own clock has run out', () => {
    // What the smoothing is for. Feed it the curve to the last millisecond and
    // there is still depth left over: a press retired on its duration would cut
    // that tail off, which is the difference between something soft letting go
    // and an animation ending.
    let ease = 0
    const dt = 1 / 60
    for (let t = 0; t < 1; t += dt) ease += (touchEase(t) - ease) * touchSettle(dt)
    expect(ease).toBeGreaterThan(0.002)
  })
})

describe('touch scheduling', () => {
  it('presses for about a second, which is long enough to watch it come back', () => {
    expect(TOUCH_DURATION_MS).toBeGreaterThan(600)
    expect(TOUCH_DURATION_MS).toBeLessThan(2000)
  })

  it('holds a handful of presses at once and no more', () => {
    // A GLSL array is fixed length, and the loop over it runs for every vertex
    // of a 37k-triangle mesh. This is the number that ends up in the shader.
    expect(TOUCH_POINTS).toBeGreaterThan(1)
    expect(TOUCH_POINTS).toBeLessThanOrEqual(8)
  })

  it('reaches further than the Kwami is wide, so the falloff does the shaping', () => {
    // Two unit directions are at most 2 apart. A radius inside that would cut
    // the dent off with a hard edge partway across the body.
    expect(TOUCH_RADIUS).toBeGreaterThan(2)
  })
})

describe('drag limits', () => {
  it('stops short of tipping the Kwami over its own pole', () => {
    // Over the top there is nothing worth looking at and no obvious way back,
    // and a creator who lands there thinks the stage has broken.
    expect(PITCH_LIMIT).toBeGreaterThan(0.5)
    expect(PITCH_LIMIT).toBeLessThan(Math.PI / 2)
  })
})
