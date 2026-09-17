import { describe, expect, it } from 'vitest'
import {
  applyHarmony,
  applyLook,
  applyPalette,
  applyRenderer,
  applySkin,
  clearTuning,
  clearTuningKey,
  initialFormState,
  linkAxes,
  randomizeGroup,
  setTuning,
  type KwamiFormState,
} from '#shared/kwami/form'
import { KWAMI_PALETTES, TUNING_RANGES, isHexColor } from '#shared/kwami/appearance'
import { KWAMI_LOOKS } from '#shared/kwami/looks'
import { KWAMI_HARMONIES } from '#shared/kwami/harmony'
import { KWAMI_SKINS, isSkin, tuningForSkin } from '#shared/kwami/skins'

/** A deterministic source, so "what does this click do" is a fixed question. */
function seeded(seed = 1): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function patched(state: KwamiFormState, patch: Partial<KwamiFormState>): KwamiFormState {
  return { ...state, ...patch }
}

describe('initialFormState', () => {
  it('opens on something already worth looking at', () => {
    // A first screen showing a default grey blob asks the creator to do design
    // work before they have decided whether they want a Kwami at all.
    const state = initialFormState()
    expect(isHexColor(state.colorA)).toBe(true)
    expect(isHexColor(state.colorB)).toBe(true)
    expect(isHexColor(state.colorC)).toBe(true)
    expect(isSkin(state.skin)).toBe(true)
    expect(state.tuning).toEqual({})
  })
})

describe('applyLook', () => {
  it('writes a whole identity in one click', () => {
    for (const look of KWAMI_LOOKS) {
      const patch = applyLook(look.id)
      expect(patch.lookId, look.id).toBe(look.id)
      expect(patch.renderer, look.id).toBe(look.renderer)
      expect(patch.skin, look.id).toBe(look.skin)
      expect(isHexColor(patch.colorC!), look.id).toBe(true)
    }
  })

  it('lays the look on top of its skin rather than beside it', () => {
    // A look that says nothing about shininess still has to land on a material
    // that reads as its skin — `chrome` at the default shininess is a grey ball.
    const look = KWAMI_LOOKS.find((l) => l.skin === 'chrome')!
    const patch = applyLook(look.id)
    const expected = { ...tuningForSkin('chrome'), ...look.tuning }
    expect(patch.tuning).toEqual(expected)
  })

  it('ignores a look that is not in the table', () => {
    expect(applyLook('not-a-look')).toEqual({})
  })
})

describe('applyPalette and applyHarmony', () => {
  it('clears the look, because the combination is no longer that combination', () => {
    const patch = applyPalette(KWAMI_PALETTES[3]!.id)
    expect(patch.lookId).toBeNull()
    expect(patch.harmonyId).toBeNull()
    expect(patch.colorC).toBe(KWAMI_PALETTES[3]!.c)
  })

  it('ignores a palette that is not in the table', () => {
    expect(applyPalette('not-a-palette')).toEqual({})
  })

  it('rolls three colours that are all usable', () => {
    for (const harmony of KWAMI_HARMONIES) {
      const rng = seeded(7)
      const patch = applyHarmony(harmony.id, rng)
      expect(patch.harmonyId, harmony.id).toBe(harmony.id)
      // Every one reaches a GLSL uniform and an SVG attribute unescaped.
      for (const key of ['colorA', 'colorB', 'colorC'] as const) {
        expect(isHexColor(patch[key]!), `${harmony.id}.${key}`).toBe(true)
      }
      // A harmony that produced one colour three times is not a harmony.
      expect(new Set([patch.colorA, patch.colorB, patch.colorC]).size, harmony.id).toBeGreaterThan(1)
    }
  })

  it('gives a different set each time the same relationship is rolled', () => {
    const rng = seeded(3)
    const first = applyHarmony('triadic', rng)
    const second = applyHarmony('triadic', rng)
    expect(first.colorA).not.toBe(second.colorA)
  })

  it('falls back to a real harmony for an unknown id', () => {
    expect(isHexColor(applyHarmony('not-a-harmony', seeded()).colorA!)).toBe(true)
  })
})

describe('applySkin', () => {
  it('moves the material sliders the creator would otherwise have to find', () => {
    const state = initialFormState()
    const patch = applySkin(state, 'chrome')
    expect(patch.skin).toBe('chrome')
    expect(patch.tuning).toMatchObject(tuningForSkin('chrome'))
  })

  it('keeps overrides that are not about the material', () => {
    const state = patched(initialFormState(), { tuning: { spin: 0.5 } })
    expect(applySkin(state, 'jade').tuning).toMatchObject({ spin: 0.5 })
  })

  it('refuses an id this build cannot compile', () => {
    // A skin name from a newer build must not reach the shader assembler, where
    // it would silently fall back to the default surface.
    expect(applySkin(initialFormState(), 'obsidian')).toEqual({})
  })

  it('covers every skin in the catalogue', () => {
    for (const skin of KWAMI_SKINS) {
      expect(applySkin(initialFormState(), skin.id).skin, skin.id).toBe(skin.id)
    }
  })
})

describe('setTuning', () => {
  it('clamps rather than trusting the input', () => {
    // A restored draft from an older build carries values from ranges that have
    // since moved, and reaches this by the same path a slider does.
    const state = initialFormState()
    expect(setTuning(state, 'amplitude', 99).tuning!.amplitude).toBe(TUNING_RANGES.amplitude.max)
    expect(setTuning(state, 'amplitude', -1).tuning!.amplitude).toBe(TUNING_RANGES.amplitude.min)
  })

  it('drops the look badge, because the Kwami is no longer that look', () => {
    const state = patched(initialFormState(), { lookId: 'pearl' })
    expect(setTuning(state, 'spin', 0.3).lookId).toBeNull()
  })

  it('ignores a value that would poison a uniform', () => {
    // NaN in `uAmplitude` does not throw — it renders nothing at all, which is
    // a very hard failure to trace back to a slider.
    expect(setTuning(initialFormState(), 'amplitude', Number.NaN)).toEqual({})
  })
})

describe('clearTuningKey and clearTuning', () => {
  it('drops one override back to whatever the preset says today', () => {
    const state = patched(initialFormState(), { tuning: { spin: 0.5, amplitude: 0.4 } })
    expect(clearTuningKey(state, 'spin').tuning).toEqual({ amplitude: 0.4 })
  })

  it('drops all of them', () => {
    expect(clearTuning().tuning).toEqual({})
  })
})

describe('linkAxes', () => {
  it('sets all three axes at once and clamps each', () => {
    const state = initialFormState()
    const patch = linkAxes(state, ['spikeX', 'spikeY', 'spikeZ'], 99)
    expect(patch.tuning).toMatchObject({
      spikeX: TUNING_RANGES.spikeX.max,
      spikeY: TUNING_RANGES.spikeY.max,
      spikeZ: TUNING_RANGES.spikeZ.max,
    })
  })

  it('skips a key that is not a tunable, rather than writing NaN into it', () => {
    const patch = linkAxes(initialFormState(), ['nope' as keyof typeof TUNING_RANGES], 1)
    expect(patch.tuning).toEqual({})
  })
})

describe('randomizeGroup', () => {
  it('stays inside every slider it moves', () => {
    const keys = ['amplitude', 'frequency', 'spikeX', 'shininess'] as const
    const patch = randomizeGroup(initialFormState(), [...keys], seeded(11))
    for (const key of keys) {
      const { min, max } = TUNING_RANGES[key]
      expect(patch.tuning![key], key).toBeGreaterThanOrEqual(min)
      expect(patch.tuning![key], key).toBeLessThanOrEqual(max)
    }
  })

  it('leaves the mesh resolution alone', () => {
    // Subdivision is not taste. A roll that dropped a Kwami to a visibly
    // faceted mesh reads as the dice having broken something.
    const patch = randomizeGroup(initialFormState(), ['resolution', 'amplitude'], seeded(5))
    expect(patch.tuning!.resolution).toBeUndefined()
    expect(patch.tuning!.amplitude).toBeDefined()
  })

  it('leaves the sections it was not asked about', () => {
    // Someone who has spent five minutes on a palette and wants a different
    // silhouette is not asking to lose the palette.
    const state = patched(initialFormState(), { tuning: { shininess: 180 } })
    const patch = randomizeGroup(state, ['amplitude'], seeded(2))
    expect(patch.tuning!.shininess).toBe(180)
  })
})

describe('applyRenderer', () => {
  it('keeps the creator overrides across a body change', () => {
    // Someone who slowed their Kwami down and then tried a different body meant
    // to keep it slow.
    const patch = applyRenderer('black-hole')
    expect(patch.tuning).toBeUndefined()
    expect(patch.renderer).toBe('black-hole')
  })
})
