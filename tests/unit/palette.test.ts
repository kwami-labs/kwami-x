import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { paletteFromMint } from '#shared/kwami/appearance'

const MINTS = [
  'DoQubWtmNa4WZTLWxe1iptCDrwf81M8LHDrZDP7pEBbL',
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'preview',
  '',
]

describe('paletteFromMint', () => {
  it('is deterministic for a given mint', () => {
    for (const mint of MINTS) {
      expect(paletteFromMint(mint)).toEqual(paletteFromMint(mint))
    }
  })

  it('gives different mints different colours', () => {
    const seen = new Set(MINTS.map((mint) => paletteFromMint(mint).a))
    expect(seen.size).toBe(MINTS.length)
  })

  /**
   * The regression this file exists for.
   *
   * The palette used to emit CSS Color 4's space-separated `hsl(200 78% 62%)`. That is valid
   * CSS, so the cards and gradients looked right — but three.js's `Color.setStyle` only matches
   * the comma form, silently falls through, and leaves the colour at its default white. Every
   * Kwami avatar rendered white, in the app and in every third-party embed.
   *
   * Asserting the string shape would not have caught it. Parsing it with the actual renderer's
   * colour class does.
   */
  it('produces colours three.js can actually parse — not white', () => {
    for (const mint of MINTS) {
      const { a, b } = paletteFromMint(mint)

      for (const [label, style] of [
        ['a', a],
        ['b', b],
      ] as const) {
        const color = new Color()
        color.setStyle(style)
        expect(color.getHexString(), `${mint} ${label} (${style}) fell back to white`).not.toBe('ffffff')
      }
    }
  })

  it('emits hex, which every consumer reads identically', () => {
    const { a, b } = paletteFromMint(MINTS[0])

    for (const style of [a, b]) {
      expect(style).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
