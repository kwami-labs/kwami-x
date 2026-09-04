import { describe, expect, it } from 'vitest'
import {
  formatCents,
  formatPercent,
  formatSol,
  formatUsd,
  formatUsdc,
  paletteFromMint,
  relativeTime,
  shortAddress,
} from '~/utils/format'

describe('formatSol', () => {
  it('picks precision from magnitude', () => {
    // A 0.00005 SOL dust balance and a 12,000 SOL pot appear on the same
    // screen; one fixed precision reads as noise at one end and a rounding
    // error at the other.
    expect(formatSol(50_000n)).toBe('0.00005 SOL')
    expect(formatSol(500_000_000n)).toBe('0.500 SOL')
    expect(formatSol(1_500_000_000n)).toBe('1.50 SOL')
    expect(formatSol(12_000_000_000_000n)).toBe('12,000.0 SOL')
  })

  it('renders zero cleanly', () => {
    expect(formatSol(0n)).toBe('0.00 SOL')
  })

  it('can drop the symbol', () => {
    expect(formatSol(1_500_000_000n, { symbol: false })).toBe('1.50')
  })

  it('accepts a number as well as a bigint', () => {
    expect(formatSol(1_500_000_000)).toBe('1.50 SOL')
  })
})

describe('formatUsdc', () => {
  it('always shows cents, because that is how people read dollars', () => {
    expect(formatUsdc(5_000_000n)).toBe('5.00 USDC')
    expect(formatUsdc(1_234_560_000n)).toBe('1,234.56 USDC')
  })
})

describe('formatUsd', () => {
  it('compresses large values and expands small ones', () => {
    expect(formatUsd(2_400_000)).toBe('$2.40M')
    expect(formatUsd(48_210)).toBe('$48,210')
    expect(formatUsd(12.5)).toBe('$12.50')
    expect(formatUsd(0.004)).toBe('$0.004')
  })

  it('separates thousands at every scale, so a grid does not mix formats', () => {
    expect(formatUsd(1_008)).toBe('$1,008.00')
    expect(formatUsd(9_999.5)).toBe('$9,999.50')
  })

  it('renders a dash rather than NaN', () => {
    expect(formatUsd(Number.NaN)).toBe('—')
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('formatCents', () => {
  it('converts from whole cents, which is how the chain stores value', () => {
    expect(formatCents(1_250)).toBe('$12.50')
    expect(formatCents(0)).toBe('$0.000')
  })
})

describe('formatPercent', () => {
  it('renders a fraction as a percentage', () => {
    expect(formatPercent(0.8)).toBe('80%')
    expect(formatPercent(0.0125, 2)).toBe('1.25%')
  })
})

describe('shortAddress', () => {
  it('keeps both ends recognisable', () => {
    expect(shortAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')).toBe('7xKX…gAsU')
  })

  it('leaves a short string alone rather than making it longer', () => {
    expect(shortAddress('abc')).toBe('abc')
  })

  it('handles null', () => {
    expect(shortAddress(null)).toBe('—')
    expect(shortAddress(undefined)).toBe('—')
  })
})

describe('paletteFromMint', () => {
  it('is stable, so a Kwami looks the same everywhere it appears', () => {
    const mint = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
    expect(paletteFromMint(mint)).toEqual(paletteFromMint(mint))
  })

  it('differs between mints', () => {
    expect(paletteFromMint('aaa').a).not.toBe(paletteFromMint('zzz').a)
  })

  it('produces two distinct, legible hues', () => {
    const { a, b } = paletteFromMint('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')
    expect(a).toMatch(/^hsl\(\d+ \d+% \d+%\)$/)
    expect(b).toMatch(/^hsl\(\d+ \d+% \d+%\)$/)
    expect(a).not.toBe(b)
  })
})

describe('relativeTime', () => {
  it('describes the past and the future', () => {
    expect(relativeTime(Date.now() - 120_000)).toMatch(/2 minutes ago/)
    expect(relativeTime(Date.now() + 3 * 3_600_000)).toMatch(/in 3 hours/)
  })
})
