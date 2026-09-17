import { describe, expect, it } from 'vitest'
import { LOW_ENERGY_MICRO, canAfford, energyStateOf, withEnergyState } from '#shared/energy/state'
import { REPLY_MICRO } from '#shared/energy/constants'
import type { KwamiState } from '#shared/types/kwami'

describe('energyStateOf', () => {
  it('calls an empty balance starving', () => {
    expect(energyStateOf(0n)).toBe('starving')
    // A negative balance should be impossible, but reading it as "full" would
    // be the one interpretation that lets a broken ledger keep selling tickets.
    expect(energyStateOf(-1n)).toBe('starving')
  })

  it('warns below a session and not above it', () => {
    expect(energyStateOf(LOW_ENERGY_MICRO - 1n)).toBe('low')
    expect(energyStateOf(LOW_ENERGY_MICRO)).toBe('full')
    expect(energyStateOf(LOW_ENERGY_MICRO + 1n)).toBe('full')
  })

  it('is not starving while any energy remains at all', () => {
    // The distinction the owner acts on: "low" is a warning they can ignore
    // once, "starving" is their Kwami already off the arena.
    expect(energyStateOf(1n)).toBe('low')
  })

  it('accepts a caller-supplied threshold for a longer session', () => {
    expect(energyStateOf(500n, 100n)).toBe('full')
    expect(energyStateOf(500n, 1_000n)).toBe('low')
  })
})

describe('canAfford', () => {
  it('lets a balance of exactly the cost pay it', () => {
    // The boundary decides whether a challenger's last reply lands or is
    // refused with time still on their clock, so it is inclusive — the same
    // direction `evaluateDeath` takes, where a Kwami exactly on the 1% line
    // survives.
    expect(canAfford(REPLY_MICRO, REPLY_MICRO)).toBe(true)
    expect(canAfford(REPLY_MICRO - 1n, REPLY_MICRO)).toBe(false)
  })

  it('affords a free operation from an empty balance', () => {
    expect(canAfford(0n, 0n)).toBe(true)
  })
})

describe('withEnergyState', () => {
  it('takes a live Kwami off the arena when it runs out', () => {
    expect(withEnergyState('live', 0n)).toBe('starving')
  })

  it('puts a starving Kwami straight back on a top-up', () => {
    // The whole reason starving is not a death: it reverses, in one payment.
    expect(withEnergyState('starving', 1n)).toBe('live')
  })

  it('never resurrects something the chain already retired', () => {
    // Buying fuel for a dead Kwami must not undo a drawdown death, and buying
    // it for a cracked one must not make a published phrase secret again.
    for (const terminal of ['dead', 'cracked'] as KwamiState[]) {
      expect(withEnergyState(terminal, 1_000_000n)).toBe(terminal)
      expect(withEnergyState(terminal, 0n)).toBe(terminal)
    }
  })

  it('leaves states nobody is being sold a session in alone', () => {
    // An empty balance on a draft is not yet anyone's problem, and marking it
    // starving would show the creator a failure before they had done anything.
    for (const quiet of ['draft', 'minted', 'paused'] as KwamiState[]) {
      expect(withEnergyState(quiet, 0n)).toBe(quiet)
      expect(withEnergyState(quiet, 5_000n)).toBe(quiet)
    }
  })

  it('is idempotent', () => {
    expect(withEnergyState(withEnergyState('live', 0n), 0n)).toBe('starving')
    expect(withEnergyState(withEnergyState('starving', 9n), 9n)).toBe('live')
  })
})
