import { describe, expect, it } from 'vitest'
import {
  applyBps,
  calculatePayout,
  evaluateDeath,
  nextState,
  splitTicket,
  usdToLamports,
  usdToUsdcBaseUnits,
  vaultUsd,
  vitality,
} from '#shared/game/economy'
import {
  AUTHOR_ROYALTY_BPS_OF_FEE,
  DEFAULT_PAYOUT_BPS,
  LAMPORTS_PER_SOL,
  PROTOCOL_FEE_BPS,
  USDC_BASE_UNITS,
} from '#shared/game/constants'

describe('applyBps', () => {
  it('takes the stated share', () => {
    expect(applyBps(1_000n, 8_000)).toBe(800n)
    expect(applyBps(1_000n, 10_000)).toBe(1_000n)
    expect(applyBps(1_000n, 0)).toBe(0n)
  })

  it('rounds down so the vault is never over-drawn', () => {
    // 8000 bps of 3 is 2.4 — paying 3 would let a winner take more than exists.
    expect(applyBps(3n, 8_000)).toBe(2n)
    expect(applyBps(1n, 8_000)).toBe(0n)
  })

  it('survives amounts far beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 10n ** 30n
    expect(applyBps(huge, 8_000)).toBe((huge * 8_000n) / 10_000n)
  })

  it('rejects nonsense basis points', () => {
    expect(() => applyBps(100n, -1)).toThrow(RangeError)
    expect(() => applyBps(100n, 10_001)).toThrow(RangeError)
    expect(() => applyBps(100n, 1.5)).toThrow(RangeError)
  })
})

describe('splitTicket', () => {
  it('conserves the ticket exactly', () => {
    for (const ticket of [0n, 1n, 999n, 50_000_000n, 123_456_789n]) {
      const s = splitTicket(ticket)
      expect(s.toVault + s.toProtocol + s.toAuthor).toBe(ticket)
    }
  })

  it('carves the author royalty out of the fee, not on top of it', () => {
    const ticket = 100_000_000n // 0.1 SOL
    const s = splitTicket(ticket)
    const fee = applyBps(ticket, PROTOCOL_FEE_BPS)
    expect(s.toVault).toBe(ticket - fee)
    expect(s.toAuthor).toBe(applyBps(fee, AUTHOR_ROYALTY_BPS_OF_FEE))
    expect(s.toProtocol + s.toAuthor).toBe(fee)
  })

  it('sends the overwhelming majority of a ticket to the pot', () => {
    const s = splitTicket(100_000_000n)
    expect(Number(s.toVault) / 100_000_000).toBeCloseTo(0.975, 5)
  })

  it('refuses negative tickets', () => {
    expect(() => splitTicket(-1n)).toThrow(RangeError)
  })
})

describe('calculatePayout', () => {
  it('pays the same share of both assets', () => {
    const payout = calculatePayout(
      { lamports: 1_000_000_000n, usdcBaseUnits: 500_000_000n },
      DEFAULT_PAYOUT_BPS,
    )
    expect(payout.lamports).toBe(800_000_000n)
    expect(payout.usdcBaseUnits).toBe(400_000_000n)
  })

  it('leaves the loser-side 20% behind so the Kwami survives a win', () => {
    const balances = { lamports: 1_000_000_000n, usdcBaseUnits: 0n }
    const payout = calculatePayout(balances, DEFAULT_PAYOUT_BPS)
    expect(balances.lamports - payout.lamports).toBe(200_000_000n)
  })

  it('handles an empty vault', () => {
    expect(calculatePayout({ lamports: 0n, usdcBaseUnits: 0n }, DEFAULT_PAYOUT_BPS)).toEqual({
      lamports: 0n,
      usdcBaseUnits: 0n,
    })
  })
})

describe('vaultUsd', () => {
  it('prices both legs', () => {
    const usd = vaultUsd({ lamports: 2n * LAMPORTS_PER_SOL, usdcBaseUnits: 50n * USDC_BASE_UNITS }, 150)
    expect(usd).toBeCloseTo(350, 6)
  })
})

describe('vitality', () => {
  it('is 1 at the high-water mark', () => {
    expect(vitality(100, 100)).toBe(1)
  })

  it('reports the surviving fraction', () => {
    expect(vitality(20, 100)).toBeCloseTo(0.2)
  })

  it('treats a never-funded Kwami as fully vital', () => {
    expect(vitality(0, 0)).toBe(1)
  })

  it('clamps a vault that somehow exceeds its recorded peak', () => {
    expect(vitality(200, 100)).toBe(1)
  })
})

describe('evaluateDeath', () => {
  it('kills on a 99% drawdown', () => {
    // 1% of the peak survives; the rule fires strictly below that.
    const verdict = evaluateDeath(9.99, 1_000)
    expect(verdict.dead).toBe(true)
    expect(verdict.cause).toBe('drawdown')
  })

  it('spares a Kwami sitting exactly on the 1% line', () => {
    expect(evaluateDeath(10, 1_000).dead).toBe(false)
  })

  it('kills on dust even when the drawdown rule has not fired', () => {
    // Down only 50% from its peak, but the peak was tiny.
    const verdict = evaluateDeath(0.9, 1.8)
    expect(verdict.dead).toBe(true)
    expect(verdict.cause).toBe('dust')
  })

  it('reports dust first when both rules fire, since it is the plainer story', () => {
    expect(evaluateDeath(0.1, 1_000).cause).toBe('dust')
  })

  it('does not kill a freshly minted, never-funded Kwami', () => {
    expect(evaluateDeath(0, 0, false).dead).toBe(false)
  })
})

describe('nextState', () => {
  it('moves a live Kwami to dead', () => {
    expect(nextState('live', { dead: true, cause: 'dust', vitality: 0 })).toBe('dead')
  })

  it('leaves a healthy Kwami alone', () => {
    expect(nextState('live', { dead: false, vitality: 0.5 })).toBe('live')
  })

  it('keeps terminal states terminal even if the vault refills', () => {
    expect(nextState('dead', { dead: false, vitality: 1 })).toBe('dead')
    expect(nextState('cracked', { dead: false, vitality: 1 })).toBe('cracked')
  })
})

describe('usd conversions', () => {
  it('round-trips a SOL amount', () => {
    const lamports = usdToLamports(150, 150)
    expect(lamports).toBe(LAMPORTS_PER_SOL)
  })

  it('converts USDC at face value', () => {
    expect(usdToUsdcBaseUnits(2.5)).toBe(2_500_000n)
  })

  it('refuses a zero or negative SOL price', () => {
    expect(() => usdToLamports(10, 0)).toThrow(RangeError)
  })
})
