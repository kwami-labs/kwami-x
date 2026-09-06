import { describe, expect, it } from 'vitest'
import { fuelAfterCommission, resolveEnergyPerSol, treasuryDelta } from '#shared/energy/receipt'
import { DEFAULT_ENERGY_PER_SOL } from '#shared/energy/constants'
import { commissionToLamports } from '#shared/game/constants'

describe('treasuryDelta', () => {
  it('reads what the treasury actually received', () => {
    expect(treasuryDelta([100, 5], [100, 705], 1)).toBe(700n)
  })

  it('reports nothing when the treasury was not in the transaction', () => {
    // `findIndex` returns -1, and indexing a balances array with it would read
    // `undefined` and credit NaN lamports.
    expect(treasuryDelta([1, 2], [3, 4], -1)).toBe(0n)
  })

  it('never credits a payout as a purchase', () => {
    // A treasury that paid out in a transaction has bought nobody any energy.
    // Crediting the absolute value would turn a refund into a top-up.
    expect(treasuryDelta([1000], [400], 0)).toBe(0n)
  })

  it('survives a transaction with no balance metadata', () => {
    expect(treasuryDelta(undefined, undefined, 0)).toBe(0n)
    expect(treasuryDelta([100], undefined, 0)).toBe(0n)
    expect(treasuryDelta([100], [200], 7)).toBe(0n)
  })

  it('widens to bigint before subtracting', () => {
    // Solana's meta balances arrive as JS numbers (already rounded past 2^53).
    // Widening first keeps the subtraction exact for every value a double can
    // still tell apart.
    const before = Number.MAX_SAFE_INTEGER - 10
    expect(treasuryDelta([before], [before + 7], 0)).toBe(7n)
  })
})

describe('fuelAfterCommission', () => {
  it('takes the commission off the top', () => {
    const commission = commissionToLamports('0.5')
    const received = commission + 200_000_000n
    expect(fuelAfterCommission(received, commission)).toBe(200_000_000n)
  })

  it('buys nothing when the receipt is only the commission', () => {
    const commission = commissionToLamports('0.5')
    expect(fuelAfterCommission(commission, commission)).toBe(0n)
  })

  it('never reads a shortfall as a debt', () => {
    // A receipt smaller than the commission means no commission was charged in
    // that bundle — an empty treasury adds no instruction at all — and a
    // negative here would credit nonsense.
    expect(fuelAfterCommission(1_000n, commissionToLamports('0.5'))).toBe(0n)
  })

  it('treats the whole receipt as fuel when there is no commission', () => {
    expect(fuelAfterCommission(700_000_000n, 0n)).toBe(700_000_000n)
  })
})

describe('resolveEnergyPerSol', () => {
  it('takes a configured value', () => {
    expect(resolveEnergyPerSol('35000', DEFAULT_ENERGY_PER_SOL)).toBe(35_000)
    expect(resolveEnergyPerSol(35_000, DEFAULT_ENERGY_PER_SOL)).toBe(35_000)
  })

  it('falls back rather than throwing on a mistyped deployment variable', () => {
    // This value reaches a page that quotes a price. A bad env var should make
    // it quote the default, not fail to render.
    for (const bad of [undefined, null, '', 'abc', '-5', '0', Number.NaN]) {
      expect(resolveEnergyPerSol(bad, DEFAULT_ENERGY_PER_SOL)).toBe(DEFAULT_ENERGY_PER_SOL)
    }
  })

  it('truncates, because the multiplier is used as a bigint', () => {
    expect(resolveEnergyPerSol('20000.9', DEFAULT_ENERGY_PER_SOL)).toBe(20_000)
  })
})
