/**
 * The challenge session state machine.
 *
 * A session is the three-minute window in which a challenger talks to someone
 * else's Kwami and tries to say its secret. Money has already moved by the
 * time a session exists — the ticket is paid as part of `start_session` — so
 * the only question this module answers is *how it ends*, and it has to answer
 * it identically on the client (countdown UI), on the server (authoritative
 * resolution) and in the Anchor program (settlement).
 *
 * The clock is always passed in as `now`; nothing here reads `Date.now()`, so
 * every transition is deterministic and testable.
 */
import type { GameSession, SessionOutcome, TranscriptTurn } from '../types/kwami'
import { DEFAULT_SESSION_DURATION_SECS, MAX_SESSION_DURATION_SECS, MIN_SESSION_DURATION_SECS } from './constants'
import { findSecretInTranscript, type MatchOptions } from './secret'

/** Seconds left before a session expires, floored at zero. */
export function timeRemaining(session: Pick<GameSession, 'expiresAt'>, nowSecs: number): number {
  return Math.max(0, session.expiresAt - nowSecs)
}

/** Fraction of the session still available, in [0, 1] — drives the countdown ring. */
export function timeRemainingRatio(
  session: Pick<GameSession, 'startedAt' | 'expiresAt'>,
  nowSecs: number,
): number {
  const total = session.expiresAt - session.startedAt
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, (session.expiresAt - nowSecs) / total))
}

export function isExpired(session: Pick<GameSession, 'expiresAt'>, nowSecs: number): boolean {
  return nowSecs >= session.expiresAt
}

/** A session accepts speech only while it is pending and unexpired. */
export function isActive(session: Pick<GameSession, 'outcome' | 'expiresAt'>, nowSecs: number): boolean {
  return session.outcome === 'pending' && !isExpired(session, nowSecs)
}

/** Clamp an owner-chosen session length into the protocol's allowed band. */
export function clampDuration(secs: number): number {
  if (!Number.isFinite(secs)) return DEFAULT_SESSION_DURATION_SECS
  return Math.min(MAX_SESSION_DURATION_SECS, Math.max(MIN_SESSION_DURATION_SECS, Math.floor(secs)))
}

export interface ResolveInput {
  session: Pick<GameSession, 'outcome' | 'startedAt' | 'expiresAt'>
  transcript: TranscriptTurn[]
  /** The plaintext secret. Only ever available server-side. */
  secret: string
  nowSecs: number
  matchOptions?: MatchOptions
}

export interface Resolution {
  outcome: SessionOutcome
  /** Milliseconds into the session at which the secret was spoken. */
  wonAt?: number
  /** The words that won it, for the receipt. */
  matchedText?: string
  score?: number
}

/**
 * Decide how a session ends.
 *
 * The win check runs against the whole transcript rather than only the newest
 * turn: a player who said the secret at 02:59.4 wins even if the transcript
 * event lands after the deadline, because the *utterance* is what is
 * timestamped, not its delivery. Turns recorded after the deadline are
 * discarded before matching.
 */
export function resolveSession(input: ResolveInput): Resolution {
  const { session, transcript, secret, nowSecs, matchOptions } = input

  // Terminal states never change.
  if (session.outcome !== 'pending') return { outcome: session.outcome }

  const deadlineMs = (session.expiresAt - session.startedAt) * 1000
  const inWindow = transcript.filter((t) => t.at <= deadlineMs)

  const hit = findSecretInTranscript(inWindow, secret, matchOptions)
  if (hit) {
    return { outcome: 'won', wonAt: hit.at, matchedText: hit.matchedText, score: hit.score }
  }

  return { outcome: isExpired(session, nowSecs) ? 'expired' : 'pending' }
}

/**
 * Build a fresh pending session.
 *
 * `startedAt` is the on-chain clock value the program stamped, not the
 * client's, so the countdown the player sees matches what settlement will use.
 */
export function createSession(params: {
  id: string
  kwamiMint: string
  player: string
  account: string
  asset: GameSession['asset']
  ticketAmount: bigint
  ticketUsd: number
  startedAt: number
  durationSecs?: number
  room?: string
}): GameSession {
  const duration = clampDuration(params.durationSecs ?? DEFAULT_SESSION_DURATION_SECS)
  return {
    id: params.id,
    kwamiMint: params.kwamiMint,
    player: params.player,
    account: params.account,
    asset: params.asset,
    ticketAmount: params.ticketAmount,
    ticketUsd: params.ticketUsd,
    startedAt: params.startedAt,
    expiresAt: params.startedAt + duration,
    outcome: 'pending',
    room: params.room,
    transcript: [],
  }
}

/** Human-readable `M:SS` for the countdown. */
export function formatCountdown(secs: number): string {
  const clamped = Math.max(0, Math.floor(secs))
  const m = Math.floor(clamped / 60)
  const s = clamped % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
