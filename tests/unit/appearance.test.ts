import { describe, expect, it } from 'vitest'
import {
  KWAMI_PALETTES,
  hslToHex,
  isHexColor,
  paletteFor,
  paletteFromMint,
  suggestPalette,
  toAppearance,
} from '#shared/kwami/appearance'

describe('isHexColor', () => {
  it('accepts six-digit hex in either case', () => {
    expect(isHexColor('#7c5cff')).toBe(true)
    expect(isHexColor('#7C5CFF')).toBe(true)
  })

  it('rejects the shapes a CSS colour input might otherwise smuggle through', () => {
    // The value reaches a GLSL uniform and an SVG attribute unescaped. A named
    // colour is harmless; `red;fill:url(#x)` is not, and neither is worth the
    // parser to tell apart.
    expect(isHexColor('#fff')).toBe(false)
    expect(isHexColor('red')).toBe(false)
    expect(isHexColor('rgb(1,2,3)')).toBe(false)
    expect(isHexColor('#7c5cff;fill:black')).toBe(false)
    expect(isHexColor('')).toBe(false)
    expect(isHexColor(undefined)).toBe(false)
    expect(isHexColor(0x7c5cff)).toBe(false)
  })
})

describe('hslToHex', () => {
  it('converts the primaries', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000')
    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00')
    expect(hslToHex(240, 1, 0.5)).toBe('#0000ff')
  })

  it('converts the achromatic ends', () => {
    expect(hslToHex(0, 0, 0)).toBe('#000000')
    expect(hslToHex(0, 0, 1)).toBe('#ffffff')
    expect(hslToHex(200, 0, 0.5)).toBe('#808080')
  })

  it('covers every sector of the wheel', () => {
    expect(hslToHex(60, 1, 0.5)).toBe('#ffff00')
    expect(hslToHex(180, 1, 0.5)).toBe('#00ffff')
    expect(hslToHex(300, 1, 0.5)).toBe('#ff00ff')
  })

  it('wraps hues outside 0–360 rather than clamping', () => {
    // `paletteFromMint` adds 140 to a hue that can already be 359.
    expect(hslToHex(380, 1, 0.5)).toBe(hslToHex(20, 1, 0.5))
    expect(hslToHex(-40, 1, 0.5)).toBe(hslToHex(320, 1, 0.5))
  })

  it('always pads to six digits', () => {
    for (let h = 0; h < 360; h += 7) {
      expect(isHexColor(hslToHex(h, 0.78, 0.62))).toBe(true)
    }
  })
})

describe('paletteFromMint', () => {
  it('is stable for the same mint', () => {
    const mint = 'Kw2Vlt111111111111111111111111111111111111111'
    expect(paletteFromMint(mint)).toEqual(paletteFromMint(mint))
  })

  it('emits hex, not a CSS colour function', () => {
    // Three.js parses `hsl()` with a comma-separated regex and silently falls
    // back to white on the space-separated CSS Color 4 form — which rendered
    // every Kwami as a grey rock while looking right in the stylesheet.
    const { a, b } = paletteFromMint('Kw1Ora111111111111111111111111111111111111111')
    expect(isHexColor(a)).toBe(true)
    expect(isHexColor(b)).toBe(true)
  })

  it('separates the two hues by 140 degrees', () => {
    const mint = 'anything'
    let hash = 0
    for (let i = 0; i < mint.length; i++) hash = (hash * 31 + mint.charCodeAt(i)) >>> 0
    const hueA = hash % 360
    const { a, b } = paletteFromMint(mint)
    expect(a).toBe(hslToHex(hueA, 0.78, 0.62))
    expect(b).toBe(hslToHex(hueA + 140, 0.72, 0.58))
  })

  it('gives different mints different colours', () => {
    const colours = new Set(['Kw1', 'Kw2', 'Kw3', 'Kw4', 'Kw5'].map((m) => paletteFromMint(m).a))
    expect(colours.size).toBe(5)
  })

  it('does not throw on an empty mint', () => {
    expect(() => paletteFromMint('')).not.toThrow()
    expect(isHexColor(paletteFromMint('').a)).toBe(true)
  })
})

describe('paletteFor', () => {
  it('prefers the palette the creator chose', () => {
    const palette = paletteFor({
      mint: 'Kw1Ora111111111111111111111111111111111111111',
      appearance: { colorA: '#ff0000', colorB: '#00ff00' },
    })
    expect(palette).toEqual({ a: '#ff0000', b: '#00ff00' })
  })

  it('falls back to the mint hash when no appearance was stored', () => {
    const mint = 'Kw1Ora111111111111111111111111111111111111111'
    expect(paletteFor({ mint, appearance: {} })).toEqual(paletteFromMint(mint))
    expect(paletteFor({ mint })).toEqual(paletteFromMint(mint))
    expect(paletteFor({ mint, appearance: null })).toEqual(paletteFromMint(mint))
  })

  it('falls back entirely rather than pairing one chosen colour with a default', () => {
    // Half-applying would produce a combination nobody picked, which is worse
    // than the derived palette the Kwami would otherwise have had.
    const mint = 'Kw3Shr111111111111111111111111111111111111111'
    expect(paletteFor({ mint, appearance: { colorA: '#ff0000' } })).toEqual(paletteFromMint(mint))
    expect(paletteFor({ mint, appearance: { colorA: '#ff0000', colorB: 'green' } })).toEqual(
      paletteFromMint(mint),
    )
  })
})

describe('toAppearance', () => {
  it('normalises a usable pair', () => {
    expect(toAppearance({ a: '#123456', b: '#abcdef' })).toEqual({
      colorA: '#123456',
      colorB: '#abcdef',
    })
  })

  it('stores nothing rather than storing something unrenderable', () => {
    expect(toAppearance({ a: '#123456', b: 'chartreuse' })).toEqual({})
    expect(toAppearance({})).toEqual({})
  })
})

describe('suggestPalette', () => {
  it('always returns one of the curated palettes', () => {
    for (const seed of ['', 'a', 'The Vault Keeper', 'x'.repeat(200)]) {
      expect(KWAMI_PALETTES).toContain(suggestPalette(seed))
    }
  })

  it('is stable for the same name', () => {
    expect(suggestPalette('Shardsong')).toBe(suggestPalette('Shardsong'))
  })

  it('every curated palette is renderable', () => {
    for (const p of KWAMI_PALETTES) {
      expect(isHexColor(p.a)).toBe(true)
      expect(isHexColor(p.b)).toBe(true)
    }
  })

  it('has no duplicate ids', () => {
    expect(new Set(KWAMI_PALETTES.map((p) => p.id)).size).toBe(KWAMI_PALETTES.length)
  })
})
