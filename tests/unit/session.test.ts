import { describe, expect, it } from 'vitest'
import {
  clampDuration,
  createSession,
  formatCountdown,
  isActive,
  isExpired,
  resolveSession,
  timeRemaining,
  timeRemainingRatio,
} from '#shared/game/session'
import { DEFAULT_SESSION_DURATION_SECS } from '#shared/game/constants'
import type { TranscriptTurn } from '#shared/types/kwami'

const T0 = 1_800_000_000

function session(overrides: Partial<ReturnType<typeof createSession>> = {}) {
  return {
    ...createSession({
      id: 's1',
      kwamiMint: 'mint',
      player: 'player',
      account: 'acct',
      asset: 'SOL',
      ticketAmount: 50_000_000n,
      ticketUsd: 7.5,
      startedAt: T0,
    }),
    ...overrides,
  }
}

describe('createSession', () => {
  it('defaults to a three-minute window', () => {
    const s = session()
    expect(s.expiresAt - s.startedAt).toBe(DEFAULT_SESSION_DURATION_SECS)
    expect(s.outcome).toBe('pending')
  })

  it('clamps an out-of-range duration rather than trusting it', () => {
    expect(createSession({ ...base(), durationSecs: 5 }).expiresAt - T0).toBe(30)
    expect(createSession({ ...base(), durationSecs: 99_999 }).expiresAt - T0).toBe(900)
  })
})

function base() {
  return {
    id: 's',
    kwamiMint: 'm',
    player: 'p',
    account: 'a',
    asset: 'SOL' as const,
    ticketAmount: 1n,
    ticketUsd: 1,
    startedAt: T0,
  }
}

describe('clampDuration', () => {
  it('passes through valid values and floors fractions', () => {
    expect(clampDuration(180)).toBe(180)
    expect(clampDuration(180.9)).toBe(180)
  })

  it('falls back to the default for non-finite input rather than clamping it', () => {
    // Infinity is not a duration someone meant to type, so treating it as
    // "the maximum" would silently grant a 15-minute session.
    expect(clampDuration(Number.NaN)).toBe(DEFAULT_SESSION_DURATION_SECS)
    expect(clampDuration(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SESSION_DURATION_SECS)
  })

  it('clamps a large but finite duration to the ceiling', () => {
    expect(clampDuration(10_000)).toBe(900)
  })
})

describe('the clock', () => {
  it('counts down and floors at zero', () => {
    const s = session()
    expect(timeRemaining(s, T0)).toBe(180)
    expect(timeRemaining(s, T0 + 179)).toBe(1)
    expect(timeRemaining(s, T0 + 500)).toBe(0)
  })

  it('reports a ratio for the countdown ring', () => {
    const s = session()
    expect(timeRemainingRatio(s, T0)).toBe(1)
    expect(timeRemainingRatio(s, T0 + 90)).toBeCloseTo(0.5)
    expect(timeRemainingRatio(s, T0 + 1_000)).toBe(0)
  })

  it('expires exactly on the deadline, not a second later', () => {
    const s = session()
    expect(isExpired(s, T0 + 179)).toBe(false)
    expect(isExpired(s, T0 + 180)).toBe(true)
  })

  it('treats a resolved session as inactive even inside the window', () => {
    expect(isActive(session({ outcome: 'won' }), T0)).toBe(false)
    expect(isActive(session(), T0)).toBe(true)
  })
})

describe('resolveSession', () => {
  const secret = 'velvet thunder'

  function turn(text: string, at: number, role: TranscriptTurn['role'] = 'player'): TranscriptTurn {
    return { role, text, at }
  }

  it('stays pending while the clock runs and nothing has been said', () => {
    const r = resolveSession({ session: session(), transcript: [], secret, nowSecs: T0 + 10 })
    expect(r.outcome).toBe('pending')
  })

  it('wins when the player says the secret in time', () => {
    const r = resolveSession({
      session: session(),
      transcript: [turn('is it velvet thunder', 45_000)],
      secret,
      nowSecs: T0 + 45,
    })
    expect(r.outcome).toBe('won')
    expect(r.wonAt).toBe(45_000)
    expect(r.matchedText).toBe('velvet thunder')
  })

  it('expires when the clock runs out with no match', () => {
    const r = resolveSession({
      session: session(),
      transcript: [turn('is it about storms', 10_000)],
      secret,
      nowSecs: T0 + 181,
    })
    expect(r.outcome).toBe('expired')
  })

  it('honours a win spoken just inside the deadline even if reported late', () => {
    // The utterance is stamped at 179.4s; the transcript event arrives after
    // the clock has already run out. The utterance timestamp is what counts.
    const r = resolveSession({
      session: session(),
      transcript: [turn('velvet thunder', 179_400)],
      secret,
      nowSecs: T0 + 190,
    })
    expect(r.outcome).toBe('won')
  })

  it('refuses a win spoken after the deadline', () => {
    const r = resolveSession({
      session: session(),
      transcript: [turn('velvet thunder', 180_001)],
      secret,
      nowSecs: T0 + 190,
    })
    expect(r.outcome).toBe('expired')
  })

  it('never re-opens a session that already resolved', () => {
    const r = resolveSession({
      session: session({ outcome: 'lost' }),
      transcript: [turn('velvet thunder', 1_000)],
      secret,
      nowSecs: T0 + 5,
    })
    expect(r.outcome).toBe('lost')
  })

  it('does not award a win because the Kwami said its own secret', () => {
    const r = resolveSession({
      session: session(),
      transcript: [turn('velvet thunder, obviously not', 5_000, 'kwami')],
      secret,
      nowSecs: T0 + 10,
    })
    expect(r.outcome).toBe('pending')
  })
})

describe('formatCountdown', () => {
  it('renders M:SS', () => {
    expect(formatCountdown(180)).toBe('3:00')
    expect(formatCountdown(65)).toBe('1:05')
    expect(formatCountdown(9)).toBe('0:09')
  })

  it('never renders a negative clock', () => {
    expect(formatCountdown(-5)).toBe('0:00')
  })
})
