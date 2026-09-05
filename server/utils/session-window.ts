import { createError } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * How late a turn may arrive and still count.
 *
 * The utterance timestamp decides the game, not arrival time: a phrase spoken at 2:59.4 should
 * win even if speech-to-text and the network take another moment to deliver it. This is the
 * allowance for that, and nothing else — it is not extra playing time, because the wall-clock
 * gate below still closes the session the moment the deadline passes.
 */
export const TURN_ARRIVAL_GRACE_MS = 5_000

/** The parts of a `game_sessions` row this module needs. */
export interface SessionRow {
  id: string
  outcome: string
  started_at: string
  expires_at: string
}

export interface SessionWindow {
  /** Server clock at the moment of the check. */
  now: number
  startedAt: number
  expiresAt: number
  /** Milliseconds from `started_at` to `expires_at` — what a turn's `at` is measured against. */
  deadlineMs: number
  /** Milliseconds of real time elapsed, clamped at zero. */
  elapsedMs: number
}

/**
 * Assert a session is still open, using the SERVER's clock, and close it if it is not.
 *
 * Every session endpoint used to guard only on `outcome !== 'pending'` — but nothing ever wrote
 * a terminal outcome when the clock ran out, so `pending` was permanent and that guard could
 * never fire. The deadline was enforced solely against a client-supplied `at`, which a player
 * could simply keep reporting as 0 to hold a session open indefinitely: unlimited turns against
 * the Kwami, unlimited queries of the similarity score, and eventually the secret.
 *
 * This is the writer that was missing. It is deliberately conditional on `outcome = 'pending'`
 * so two concurrent requests cannot both claim to have expired the session.
 *
 * @throws 409 once the window has closed, 403/404 handled by the caller.
 */
export async function assertSessionOpen(
  db: SupabaseClient,
  session: SessionRow,
  options: { graceMs?: number } = {},
): Promise<SessionWindow> {
  if (session.outcome !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'Session is over.' })
  }

  const now = Date.now()
  const startedAt = new Date(session.started_at).getTime()
  const expiresAt = new Date(session.expires_at).getTime()

  if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) {
    throw createError({ statusCode: 500, statusMessage: 'Session has no usable window.' })
  }

  if (now > expiresAt + (options.graceMs ?? 0)) {
    await db
      .from('game_sessions')
      .update({ outcome: 'expired' })
      .eq('id', session.id)
      .eq('outcome', 'pending')
    throw createError({ statusCode: 409, statusMessage: 'Session has expired.' })
  }

  return {
    now,
    startedAt,
    expiresAt,
    deadlineMs: expiresAt - startedAt,
    elapsedMs: Math.max(0, now - startedAt),
  }
}

/**
 * Clamp a client-reported turn offset to something the server clock can vouch for.
 *
 * `at` arrives from the browser and is stored, compared against the deadline, and shown back in
 * the transcript. A client cannot gain time by under-reporting it — `assertSessionOpen` closes
 * the session on real time regardless — but it should not be able to write a timestamp from the
 * future either, so cap it at the elapsed window plus the arrival grace.
 */
export function clampTurnOffset(at: number, window: SessionWindow): number {
  return Math.max(0, Math.min(at, window.elapsedMs + TURN_ARRIVAL_GRACE_MS))
}
