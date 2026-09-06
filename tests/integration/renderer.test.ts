import { describe, expect, it } from 'vitest'
import { RENDERER_PRESETS } from '~/utils/kwami-renderer'
import { TUNING_RANGES, readTuning, toAppearance } from '#shared/kwami/appearance'
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
      expect(preset.detail, name).toBeGreaterThanOrEqual(3)
      // An icosphere at detail 6 is ~40k vertices — past the point where a
      // mid-range phone holds 60fps with several cards on screen.
      expect(preset.detail, name).toBeLessThanOrEqual(5)
      expect(preset.particles, name).toBeGreaterThanOrEqual(0)
      expect(preset.rimPower, name).toBeGreaterThan(0)
    }
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
