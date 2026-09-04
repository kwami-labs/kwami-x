import { describe, expect, it } from 'vitest'
import { RENDERER_PRESETS } from '~/utils/kwami-renderer'
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
    const signatures = Object.values(RENDERER_PRESETS).map((p) => `${p.amplitude}:${p.frequency}:${p.particles}`)
    expect(new Set(signatures).size).toBe(signatures.length)
  })
})
