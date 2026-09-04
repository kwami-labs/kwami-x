import { describe, expect, it } from 'vitest'
import { DEMO_KWAMIS } from '~~/server/utils/demo'
import { evaluateDeath, vaultUsd, vitality } from '#shared/game/economy'

/**
 * The demo dataset is what a fresh clone shows before any infrastructure
 * exists, so it is also the first impression of whether the numbers make sense.
 * These assertions keep it internally consistent with the real game rules
 * rather than being a bag of plausible-looking figures.
 */
describe('demo dataset', () => {
  it('has a spread of renderers, so the arena is not five identical blobs', () => {
    expect(new Set(DEMO_KWAMIS.map((k) => k.renderer)).size).toBeGreaterThanOrEqual(4)
  })

  it('prices every Kwami in at least one asset', () => {
    for (const k of DEMO_KWAMIS) {
      expect(k.ticket_price_lamports + k.ticket_price_usdc, k.name).toBeGreaterThan(0)
    }
  })

  it('computes value_cents consistently with vaultUsd at the seeded SOL price', () => {
    for (const k of DEMO_KWAMIS) {
      const usd = vaultUsd({ lamports: BigInt(k.balance_lamports), usdcBaseUnits: BigInt(k.balance_usdc) }, 150)
      expect(k.value_cents, k.name).toBe(Math.round(usd * 100))
    }
  })

  it('computes vitality consistently with the shared rule', () => {
    for (const k of DEMO_KWAMIS) {
      expect(k.vitality, k.name).toBeCloseTo(vitality(k.value_cents, k.high_water_mark_cents), 6)
    }
  })

  it('derives the prize from the payout split', () => {
    for (const k of DEMO_KWAMIS) {
      expect(k.prize_lamports, k.name).toBe(Math.floor((k.balance_lamports * k.payout_bps) / 10_000))
      expect(k.prize_usdc, k.name).toBe(Math.floor((k.balance_usdc * k.payout_bps) / 10_000))
    }
  })

  it('marks a Kwami dead only when the death rules agree', () => {
    for (const k of DEMO_KWAMIS) {
      const verdict = evaluateDeath(k.value_cents / 100, k.high_water_mark_cents / 100)
      expect(verdict.dead, `${k.name} is ${k.state} but the rules say dead=${verdict.dead}`).toBe(
        k.state === 'dead',
      )
    }
  })

  it('includes at least one dead Kwami, so the state is visible in the arena', () => {
    expect(DEMO_KWAMIS.some((k) => k.state === 'dead')).toBe(true)
  })

  it('never reports more wins than attempts', () => {
    for (const k of DEMO_KWAMIS) {
      expect(k.sessions_won, k.name).toBeLessThanOrEqual(k.sessions_played)
    }
  })

  it('uses distinct mints, since they key every lookup and colour palette', () => {
    expect(new Set(DEMO_KWAMIS.map((k) => k.mint)).size).toBe(DEMO_KWAMIS.length)
  })
})
