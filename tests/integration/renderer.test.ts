import { describe, expect, it } from 'vitest'
import {
  KWAMI_FRAME_RADIUS,
  KWAMI_VERTEX_SHADER,
  RENDERER_PRESETS,
  buildKwamiFragmentShader,
  cameraDistanceFor,
  resolveRendererParams,
  segmentsForResolution,
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
