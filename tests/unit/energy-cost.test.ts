import { describe, expect, it } from 'vitest'
import {
  affordableVoiceSeconds,
  ceilDiv,
  costOf,
  energyFromLamports,
  estimateSessionMicro,
  fromEnergy,
  lamportsForEnergy,
  toEnergy,
} from '#shared/energy/cost'
import {
  CODEGEN_MICRO,
  DEFAULT_ENERGY_PER_SOL,
  FREE_TRIAL_MICRO,
  MICRO_PER_ENERGY,
  REPLY_MICRO,
  VOICE_MICRO_PER_SECOND,
} from '#shared/energy/constants'
import { LAMPORTS_PER_SOL } from '#shared/game/constants'

describe('costOf', () => {
  it('charges the flat rate for a reply and a generation', () => {
    expect(costOf({ kind: 'reply' })).toBe(REPLY_MICRO)
    expect(costOf({ kind: 'codegen' })).toBe(CODEGEN_MICRO)
  })

  it('charges speech by the second', () => {
    expect(costOf({ kind: 'voice', seconds: 1 })).toBe(VOICE_MICRO_PER_SECOND)
    expect(costOf({ kind: 'voice', seconds: 60 })).toBe(VOICE_MICRO_PER_SECOND * 60n)
  })

  it('rounds a debit up, so a Kwami cannot be talked to for free a fraction at a time', () => {
    // 0.1s at 50 micro/s is 5 micro exactly; 0.101s is 5.05 and must cost 6.
    // Rounding down here would let a caller split one second into ten tenths
    // and pay nothing at all for any of them.
    expect(costOf({ kind: 'voice', seconds: 0.1 })).toBe(5n)
    expect(costOf({ kind: 'voice', seconds: 0.101 })).toBe(6n)
    expect(costOf({ kind: 'voice', seconds: 0.001 })).toBe(1n)
  })

  it('charges nothing for speech that did not happen', () => {
    expect(costOf({ kind: 'voice', seconds: 0 })).toBe(0n)
    expect(costOf({ kind: 'voice', seconds: -5 })).toBe(0n)
    expect(costOf({ kind: 'voice', seconds: Number.NaN })).toBe(0n)
    expect(costOf({ kind: 'voice', seconds: Number.POSITIVE_INFINITY })).toBe(0n)
  })
})

describe('affordableVoiceSeconds', () => {
  it('converts a balance into whole seconds of talk', () => {
    expect(affordableVoiceSeconds(VOICE_MICRO_PER_SECOND * 180n)).toBe(180)
    expect(affordableVoiceSeconds(FREE_TRIAL_MICRO)).toBe(800)
  })

  // The mirror image of `costOf` rounding up. A ceiling that rounded up would
  // grant a second the balance cannot pay for, and the charge for it would then
  // be refused — one unpaid second per connection, every connection.
  it('rounds down, so the ceiling is never more than the balance can pay', () => {
    expect(affordableVoiceSeconds(VOICE_MICRO_PER_SECOND * 2n + 49n)).toBe(2)
    expect(affordableVoiceSeconds(VOICE_MICRO_PER_SECOND - 1n)).toBe(0)
  })

  it('is zero for an empty or impossible balance, which is what refuses a room', () => {
    expect(affordableVoiceSeconds(0n)).toBe(0)
    expect(affordableVoiceSeconds(-100n)).toBe(0)
  })

  it('never quotes more than the charge for that many seconds costs', () => {
    for (const micro of [0n, 1n, 49n, 50n, 51n, 999n, 40_000n, 123_456n]) {
      const seconds = affordableVoiceSeconds(micro)
      expect(costOf({ kind: 'voice', seconds })).toBeLessThanOrEqual(micro)
    }
  })
})

describe('estimateSessionMicro', () => {
  it('adds the spoken minutes to the replies', () => {
    expect(estimateSessionMicro(180, 10)).toBe(VOICE_MICRO_PER_SECOND * 180n + REPLY_MICRO * 10n)
  })

  it('treats nonsense inputs as nothing rather than throwing', () => {
    expect(estimateSessionMicro(-10, -4)).toBe(0n)
  })
})

describe('energyFromLamports', () => {
  it('credits one SOL as the configured energy', () => {
    expect(energyFromLamports(LAMPORTS_PER_SOL, DEFAULT_ENERGY_PER_SOL)).toBe(
      BigInt(DEFAULT_ENERGY_PER_SOL) * MICRO_PER_ENERGY,
    )
  })

  it('stays exact at amounts where a float would already have drifted', () => {
    // lamports * energyPerSol passes 2^53 at well under a tenth of a SOL, so
    // doing this in Number would silently credit a rounded figure.
    const lamports = 123_456_789n
    expect(energyFromLamports(lamports, DEFAULT_ENERGY_PER_SOL)).toBe(
      (lamports * BigInt(DEFAULT_ENERGY_PER_SOL) * MICRO_PER_ENERGY) / LAMPORTS_PER_SOL,
    )
  })

  it('rounds a credit down, so a deposit never buys more than it paid for', () => {
    // One lamport at 20 000 energy/SOL is 0.02 micro — worth nothing, and it
    // must credit nothing rather than a whole unit.
    expect(energyFromLamports(1n, DEFAULT_ENERGY_PER_SOL)).toBe(0n)
  })

  it('credits nothing for a non-payment', () => {
    expect(energyFromLamports(0n, DEFAULT_ENERGY_PER_SOL)).toBe(0n)
    expect(energyFromLamports(-1n, DEFAULT_ENERGY_PER_SOL)).toBe(0n)
    expect(energyFromLamports(LAMPORTS_PER_SOL, 0)).toBe(0n)
    expect(energyFromLamports(LAMPORTS_PER_SOL, Number.NaN)).toBe(0n)
  })
})

describe('lamportsForEnergy', () => {
  it('inverts energyFromLamports', () => {
    const micro = BigInt(DEFAULT_ENERGY_PER_SOL) * MICRO_PER_ENERGY
    expect(lamportsForEnergy(micro, DEFAULT_ENERGY_PER_SOL)).toBe(LAMPORTS_PER_SOL)
  })

  it('quotes up, so the price shown always covers the energy promised', () => {
    // A quote rounded down would take the payment and then credit one unit
    // less than the number the creator was looking at when they approved it.
    const quoted = lamportsForEnergy(1n, DEFAULT_ENERGY_PER_SOL)
    expect(energyFromLamports(quoted, DEFAULT_ENERGY_PER_SOL)).toBeGreaterThanOrEqual(1n)
  })

  it('quotes nothing for nothing', () => {
    expect(lamportsForEnergy(0n, DEFAULT_ENERGY_PER_SOL)).toBe(0n)
    expect(lamportsForEnergy(-5n, DEFAULT_ENERGY_PER_SOL)).toBe(0n)
    expect(lamportsForEnergy(1_000n, 0)).toBe(0n)
  })
})

describe('display conversion', () => {
  it('rounds displayed energy down, so the meter never promises more than is there', () => {
    expect(toEnergy(1_999n)).toBe(1)
    expect(toEnergy(999n)).toBe(0)
    expect(toEnergy(2_000n)).toBe(2)
  })

  it('round-trips whole units', () => {
    expect(toEnergy(fromEnergy(42))).toBe(42)
  })

  it('treats nonsense as nothing', () => {
    expect(fromEnergy(-1)).toBe(0n)
    expect(fromEnergy(Number.NaN)).toBe(0n)
  })
})

describe('ceilDiv', () => {
  it('refuses a non-positive divisor rather than dividing by zero', () => {
    expect(() => ceilDiv(10n, 0n)).toThrow(RangeError)
    expect(() => ceilDiv(10n, -1n)).toThrow(RangeError)
  })

  it('credits nothing for a non-positive amount, so a zero debit stays zero', () => {
    expect(ceilDiv(0n, 3n)).toBe(0n)
    expect(ceilDiv(-4n, 3n)).toBe(0n)
  })
})

describe('rounding guards', () => {
  it('charges nothing for a zero-length op rather than a whole unit', () => {
    // `ceilDiv` rounds away from zero, so guarding the non-positive case is
    // what stops "no speech happened" costing one micro-energy every turn.
    expect(costOf({ kind: 'voice', seconds: 0 })).toBe(0n)
  })

  it('is exact at amounts a double would round', () => {
    // A whale top-up: lamports * energyPerSol * 1000 is far past 2^53, and a
    // float would credit a rounded figure that the ledger could never
    // reconcile against the chain.
    const huge = 10n ** 12n
    expect(energyFromLamports(huge, DEFAULT_ENERGY_PER_SOL)).toBe(
      (huge * BigInt(DEFAULT_ENERGY_PER_SOL) * MICRO_PER_ENERGY) / LAMPORTS_PER_SOL,
    )
  })
})
