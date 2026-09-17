import { describe, expect, it } from 'vitest'
import { KWAMI_SKINS } from '#shared/kwami/skins'
import { skinSwatch } from '~/utils/skin-swatch'

const A = '#aabbcc'
const B = '#ddeeff'
const C = '#112233'

describe('skinSwatch', () => {
  it('gives every skin a distinct swatch, so the gallery can tell them apart', () => {
    // Twenty-two WebGL previews would kill the stage next to them. The CSS
    // stand-ins only have to be different from each other — a scan of the grid
    // that cannot tell `stepped` from `flat` is a grid of identical buttons.
    const swatches = KWAMI_SKINS.map((s) => skinSwatch(s.id, A, B, C))
    expect(swatches.every((css) => css.length > 0)).toBe(true)
    expect(new Set(swatches).size).toBe(KWAMI_SKINS.length)
  })

  it('puts the creator colours into the skins that actually read them', () => {
    for (const skin of KWAMI_SKINS.filter((s) => s.family === 'colour')) {
      const css = skinSwatch(skin.id, A, B, C)
      expect(css, skin.id).toContain(A)
      if (skin.colors >= 2) expect(css, skin.id).toContain(B)
      if (skin.colors >= 3) expect(css, skin.id).toContain(C)
    }
  })
})
