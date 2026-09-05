import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertSessionOpen,
  clampTurnOffset,
  TURN_ARRIVAL_GRACE_MS,
  type SessionRow,
} from '../../server/utils/session-window'

/**
 * A session that started three minutes before `now` minus `remainingMs`.
 * `expires_at` is always exactly DEFAULT_SESSION_DURATION_SECS after `started_at`.
 */
const DURATION_MS = 180_000

function sessionAt(now: number, remainingMs: number, outcome = 'pending'): SessionRow {
  const expiresAt = now + remainingMs
  return {
    id: 'session-1',
    outcome,
    started_at: new Date(expiresAt - DURATION_MS).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
  }
}

/** A Supabase stub that records the conditional expiry write. */
function dbStub() {
  const writes: Array<{ update: Record<string, unknown>; eq: Array<[string, unknown]> }> = []
  const db = {
    writes,
    from() {
      const eq: Array<[string, unknown]> = []
      let update: Record<string, unknown> = {}
      const chain = {
        update(values: Record<string, unknown>) {
          update = values
          return chain
        },
        eq(column: string, value: unknown) {
          eq.push([column, value])
          // The call is awaited, so the last `eq` in the chain has to be thenable.
          return Object.assign(chain, {
            then: (resolve: (v: unknown) => void) => {
              writes.push({ update, eq })
              resolve({ error: null })
            },
          })
        },
      }
      return chain
    },
  }
  return db as unknown as Parameters<typeof assertSessionOpen>[0] & { writes: typeof writes }
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('assertSessionOpen', () => {
  it('returns the window while the session is still running', async () => {
    const now = Date.now()
    const db = dbStub()

    const window = await assertSessionOpen(db, sessionAt(now, 60_000))

    expect(window.deadlineMs).toBe(DURATION_MS)
    expect(window.elapsedMs).toBeGreaterThan(0)
    expect(db.writes).toHaveLength(0)
  })

  it('closes the session once the server clock passes the deadline', async () => {
    // The bug this defends: the only deadline check used to be against a client-supplied
    // `at`, so a player reporting `at: 0` forever kept a session open indefinitely.
    const db = dbStub()
    const session = sessionAt(Date.now(), -1_000)

    await expect(assertSessionOpen(db, session)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('writes the expiry exactly once, and only while the row is still pending', async () => {
    const db = dbStub()

    await expect(assertSessionOpen(db, sessionAt(Date.now(), -1_000))).rejects.toBeTruthy()

    expect(db.writes).toHaveLength(1)
    expect(db.writes[0].update).toEqual({ outcome: 'expired' })
    // The `outcome = pending` predicate is what stops two concurrent requests both expiring it.
    expect(db.writes[0].eq).toContainEqual(['outcome', 'pending'])
    expect(db.writes[0].eq).toContainEqual(['id', 'session-1'])
  })

  it('allows a turn that lands inside the arrival grace', async () => {
    const db = dbStub()

    const window = await assertSessionOpen(db, sessionAt(Date.now(), -(TURN_ARRIVAL_GRACE_MS - 500)), {
      graceMs: TURN_ARRIVAL_GRACE_MS,
    })

    expect(window.expiresAt).toBeLessThan(window.now)
    expect(db.writes).toHaveLength(0)
  })

  it('rejects a turn that lands beyond the arrival grace', async () => {
    const db = dbStub()

    await expect(
      assertSessionOpen(db, sessionAt(Date.now(), -(TURN_ARRIVAL_GRACE_MS + 1_000)), {
        graceMs: TURN_ARRIVAL_GRACE_MS,
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses a session that already has a terminal outcome', async () => {
    const db = dbStub()

    for (const outcome of ['won', 'lost', 'expired', 'aborted']) {
      await expect(assertSessionOpen(db, sessionAt(Date.now(), 60_000, outcome))).rejects.toMatchObject({
        statusCode: 409,
      })
    }
    // A terminal session needs no expiry write.
    expect(db.writes).toHaveLength(0)
  })

  it('refuses a row whose window cannot be parsed rather than treating it as open', async () => {
    const db = dbStub()

    await expect(
      assertSessionOpen(db, {
        id: 'session-1',
        outcome: 'pending',
        started_at: 'not a date',
        expires_at: 'not a date',
      }),
    ).rejects.toMatchObject({ statusCode: 500 })
  })
})

describe('clampTurnOffset', () => {
  const window = { now: 0, startedAt: 0, expiresAt: DURATION_MS, deadlineMs: DURATION_MS, elapsedMs: 60_000 }

  it('passes an honest offset through', () => {
    expect(clampTurnOffset(59_000, window)).toBe(59_000)
  })

  it('caps an offset from the future at the elapsed window plus the grace', () => {
    expect(clampTurnOffset(999_999, window)).toBe(60_000 + TURN_ARRIVAL_GRACE_MS)
  })

  it('never returns a negative offset', () => {
    expect(clampTurnOffset(-5, window)).toBe(0)
  })

  it('leaves under-reporting alone — the wall clock, not this, is what closes the session', () => {
    // Clamping cannot fix under-reporting, and should not pretend to: `assertSessionOpen`
    // is the defence. This test exists so nobody later mistakes clamping for the fix.
    expect(clampTurnOffset(0, window)).toBe(0)
  })
})
