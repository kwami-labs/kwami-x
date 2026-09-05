import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MINT_COMMISSION_LAMPORTS,
  DEFAULT_MINT_COMMISSION_SOL,
  LAMPORTS_PER_SOL,
  commissionToLamports,
} from '#shared/game/constants'

describe('commissionToLamports', () => {
  it('converts the documented default', () => {
    expect(commissionToLamports('0.5')).toBe(500_000_000n)
    expect(commissionToLamports(DEFAULT_MINT_COMMISSION_SOL)).toBe(DEFAULT_MINT_COMMISSION_LAMPORTS)
  })

  it('agrees with the constant pair', () => {
    expect(DEFAULT_MINT_COMMISSION_LAMPORTS).toBe(
      BigInt(DEFAULT_MINT_COMMISSION_SOL * Number(LAMPORTS_PER_SOL)),
    )
  })

  it('handles whole SOL and zero', () => {
    expect(commissionToLamports('1')).toBe(LAMPORTS_PER_SOL)
    expect(commissionToLamports('2.5')).toBe(2_500_000_000n)
    expect(commissionToLamports('0')).toBe(0n)
    expect(commissionToLamports(0)).toBe(0n)
  })

  it('is exact for decimals that float multiplication is not', () => {
    // `0.29 * 1e9` is 289999999.99999994 in IEEE 754, which `BigInt()` refuses
    // outright — the whole reason this parses digits instead of multiplying.
    expect(commissionToLamports('0.29')).toBe(290_000_000n)
    expect(commissionToLamports(0.29)).toBe(290_000_000n)
    expect(commissionToLamports('0.07')).toBe(70_000_000n)
    expect(commissionToLamports('1.1')).toBe(1_100_000_000n)
  })

  it('keeps lamport precision and does not round beyond it', () => {
    expect(commissionToLamports('0.000000001')).toBe(1n)
    // A tenth of a lamport does not exist; the extra digit is dropped, not
    // rounded up into a fee nobody configured.
    expect(commissionToLamports('0.0000000019')).toBe(1n)
  })

  it('treats an unusable value as no commission at all', () => {
    // An unset or fat-fingered env var must not become a charge. Every one of
    // these reaches the browser as a string from runtime config.
    expect(commissionToLamports('')).toBe(0n)
    expect(commissionToLamports('   ')).toBe(0n)
    expect(commissionToLamports('abc')).toBe(0n)
    expect(commissionToLamports('0.5 SOL')).toBe(0n)
    expect(commissionToLamports('-1')).toBe(0n)
    expect(commissionToLamports('1e9')).toBe(0n)
    expect(commissionToLamports(Number.NaN)).toBe(0n)
  })

  it('tolerates surrounding whitespace from a copy-pasted env value', () => {
    expect(commissionToLamports(' 0.5 ')).toBe(500_000_000n)
  })
})
