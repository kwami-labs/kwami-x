/**
 * Response shapes for the HTTP API.
 *
 * Nitro infers types for literal route paths, but every Kwami route is built
 * from a runtime mint (`/api/kwami/${mint}`), which defeats that inference and
 * leaves callers with `{}`. Declaring the shapes here restores type safety at
 * the call site and gives one place to change when a field moves.
 */
import type { KwamiRenderer, KwamiState, ResolutionMode, SessionOutcome } from './kwami'

/** A row of `kwamis_public`. Numbers arrive as JSON numbers, not bigints. */
export interface KwamiPublic {
  id: string
  mint: string
  vault: string | null
  name: string
  tagline: string
  persona: string
  renderer: KwamiRenderer
  appearance?: Record<string, unknown>
  voice?: Record<string, unknown>
  hints: string[]
  state: KwamiState
  resolution_mode: ResolutionMode
  author_wallet: string
  owner_wallet: string
  ticket_price_lamports: number
  ticket_price_usdc: number
  session_duration: number
  payout_bps: number
  balance_lamports: number
  balance_usdc: number
  high_water_mark_cents: number
  sessions_played: number
  sessions_won: number
  value_cents: number
  vitality: number
  prize_lamports: number
  prize_usdc: number
  win_rate?: number
  created_at: string
  published_at: string | null
  died_at?: string | null
  author_handle: string | null
}

export interface KwamiListResponse {
  demo: boolean
  kwamis: KwamiPublic[]
  totals: { pot: number; live: number; sessions: number }
}

export interface SessionSummary {
  id: string
  outcome: SessionOutcome
  asset: 'SOL' | 'USDC'
  ticket_amount: number
  started_at: string
  payout_lamports: number
  payout_usdc: number
}

export interface KwamiDetailResponse {
  demo: boolean
  kwami: KwamiPublic
  recentSessions: SessionSummary[]
}

export interface DocsResponse {
  slug: string
  title: string
  html: string
  toc: string[]
}
