import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluateDeath, vaultUsd, vitality } from '#shared/game/economy'

const config = {
  public: {
    supabaseUrl: '',
    supabaseProjectId: 'your-project',
    supabasePublishableKey: 'sb_publishable_...',
  },
  supabaseSecretKey: 'sb_secret_...',
}

vi.stubGlobal('useRuntimeConfig', () => config)
vi.stubGlobal('createError', (opts: { statusCode: number; statusMessage: string }) => {
  const error = new Error(opts.statusMessage) as Error & { statusCode: number }
  error.statusCode = opts.statusCode
  return error
})

const { DEMO_KWAMIS, demoSessions, isDemoMode, assertNotDemo } = await import('~~/server/utils/demo')

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
      const usd = vaultUsd(
        { lamports: BigInt(k.balance_lamports), usdcBaseUnits: BigInt(k.balance_usdc) },
        150,
      )
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

  it('includes at least one dead Kwami, so the arena shows the state', () => {
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

describe('demoSessions', () => {
  it('never invents more rows than the Kwami has played', () => {
    const k = DEMO_KWAMIS.find((d) => d.sessions_played > 0)!
    expect(demoSessions(k).length).toBe(Math.min(k.sessions_played, 12))
    expect(demoSessions(k, 3).length).toBe(Math.min(k.sessions_played, 3))
  })

  it('places wins first and keeps their count honest', () => {
    const k = DEMO_KWAMIS.find((d) => d.sessions_won > 0)!
    const sessions = demoSessions(k)
    const wins = sessions.filter((s) => s.outcome === 'won')
    expect(wins.length).toBe(Math.min(k.sessions_won, sessions.length))
    expect(sessions.slice(0, wins.length).every((s) => s.outcome === 'won')).toBe(true)
  })

  it('pays out only on wins, in the Kwami prize amounts', () => {
    const k = DEMO_KWAMIS.find((d) => d.sessions_won > 0)!
    for (const s of demoSessions(k)) {
      if (s.outcome === 'won') {
        expect(s.payout_lamports).toBe(k.prize_lamports)
        expect(s.payout_usdc).toBe(k.prize_usdc)
        expect(s.tx_claim).toBeTruthy()
      } else {
        expect(s.payout_lamports + s.payout_usdc).toBe(0)
        expect(s.tx_claim).toBeNull()
      }
    }
  })

  it('is deterministic for a given mint', () => {
    const k = DEMO_KWAMIS[0]!
    // An explicit clock, so this asserts determinism rather than racing the
    // hour boundary the default is rounded to.
    const now = Date.parse('2026-09-05T12:34:56.789Z')
    expect(demoSessions(k, 12, now)).toEqual(demoSessions(k, 12, now))
  })

  it('does not change within the hour', () => {
    // The ledger is rendered on the server and again on the client. Two calls
    // seconds apart returning different timestamps is a hydration mismatch.
    const k = DEMO_KWAMIS[0]!
    const base = Date.parse('2026-09-05T12:00:00.000Z')
    expect(demoSessions(k, 12, base)).toEqual(demoSessions(k, 12, base + 59 * 60_000))
  })
})

describe('isDemoMode / assertNotDemo', () => {
  beforeEach(() => {
    config.public.supabaseUrl = ''
    config.public.supabaseProjectId = 'your-project'
    config.public.supabasePublishableKey = 'sb_publishable_...'
    config.supabaseSecretKey = 'sb_secret_...'
  })

  it('treats .env.example placeholders as demo mode', () => {
    expect(isDemoMode()).toBe(true)
  })

  it('leaves demo mode once project id and secret key look real', () => {
    config.public.supabaseProjectId = 'svxhshwgdigbsbjczzou'
    config.supabaseSecretKey = 'sb_secret_FB0YsRealLookingKeyValueHere'
    expect(isDemoMode()).toBe(false)
  })

  it('blocks writes while demo mode is on', () => {
    expect(() => assertNotDemo()).toThrow(/demo mode/i)
  })

  it('allows writes once credentials are real', () => {
    config.public.supabaseProjectId = 'svxhshwgdigbsbjczzou'
    config.supabaseSecretKey = 'sb_secret_FB0YsRealLookingKeyValueHere'
    expect(() => assertNotDemo()).not.toThrow()
  })
})
