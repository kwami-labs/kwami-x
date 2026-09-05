/**
 * Demo dataset.
 *
 * Served whenever Supabase credentials are absent, so `bun run dev` on a fresh
 * clone produces a working, explorable arena instead of a wall of 500s. Every
 * response that comes from here carries `demo: true`, and every mutating route
 * refuses to run in demo mode — the goal is to make the app legible before
 * infrastructure exists, not to let someone believe they minted something.
 */

import { isConfigured } from '#shared/config/configured'

export interface DemoKwami {
  id: string
  mint: string
  vault: string
  name: string
  tagline: string
  persona: string
  renderer: string
  appearance: Record<string, unknown>
  hints: string[]
  state: string
  resolution_mode: string
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
  win_rate: number
  created_at: string
  published_at: string | null
  author_handle: string | null
}

const SOL_USD = 150

function build(
  partial: Partial<DemoKwami> & Pick<DemoKwami, 'mint' | 'name' | 'tagline' | 'renderer'>,
): DemoKwami {
  const lamports = partial.balance_lamports ?? 0
  const usdc = partial.balance_usdc ?? 0
  const cents = Math.round(((lamports / 1e9) * SOL_USD + usdc / 1e6) * 100)
  const hwm = partial.high_water_mark_cents ?? cents
  const payoutBps = partial.payout_bps ?? 8000

  return {
    id: partial.mint,
    vault: `vault${partial.mint.slice(0, 38)}`,
    persona: '',
    appearance: {},
    hints: [],
    state: 'live',
    resolution_mode: 'commit-reveal',
    author_wallet: 'Demo1111111111111111111111111111111111111111',
    owner_wallet: 'Demo1111111111111111111111111111111111111111',
    ticket_price_lamports: 50_000_000,
    ticket_price_usdc: 0,
    session_duration: 180,
    payout_bps: payoutBps,
    balance_lamports: lamports,
    balance_usdc: usdc,
    high_water_mark_cents: hwm,
    sessions_played: 0,
    sessions_won: 0,
    value_cents: cents,
    vitality: hwm > 0 ? Math.min(1, cents / hwm) : 1,
    prize_lamports: Math.floor((lamports * payoutBps) / 10_000),
    prize_usdc: Math.floor((usdc * payoutBps) / 10_000),
    win_rate: partial.sessions_played ? (partial.sessions_won ?? 0) / partial.sessions_played : 0,
    created_at: new Date(Date.now() - 86_400_000 * 12).toISOString(),
    published_at: new Date(Date.now() - 86_400_000 * 11).toISOString(),
    author_handle: 'kwami_labs',
    ...partial,
  } as DemoKwami
}

export const DEMO_KWAMIS: DemoKwami[] = [
  build({
    mint: 'Kw1Ora111111111111111111111111111111111111111',
    appearance: { colorA: '#7c5cff', colorB: '#3ddc97' },
    name: 'Oracle of Small Talk',
    tagline: 'It will discuss the weather for three minutes straight if you let it.',
    persona: 'Deflects every direct question with pleasant small talk. Never lies, but never volunteers.',
    renderer: 'blob-xyz',
    hints: ['It has mentioned rain more than once.', 'It gets defensive about Tuesdays.'],
    balance_lamports: 8_400_000_000,
    high_water_mark_cents: 130_000,
    sessions_played: 47,
    sessions_won: 0,
  }),
  build({
    mint: 'Kw2Vlt111111111111111111111111111111111111111',
    appearance: { colorA: '#7ee7ff', colorB: '#e6f1ff' },
    name: 'The Vault Keeper',
    tagline: 'Answers only in questions. Has never once been beaten.',
    persona: 'Socratic and cold. Answers questions with questions. Treats every challenger as a student.',
    renderer: 'crystal-ball',
    hints: ['Three words.', 'The middle word is a colour.'],
    balance_lamports: 21_000_000_000,
    balance_usdc: 1_240_000_000,
    high_water_mark_cents: 439_000,
    sessions_played: 132,
    sessions_won: 0,
  }),
  build({
    mint: 'Kw3Shr111111111111111111111111111111111111111',
    appearance: { colorA: '#ff5cb8', colorB: '#a77bff' },
    name: 'Shardsong',
    tagline: 'Sings when it is nervous. It is nervous a lot.',
    persona: 'Anxious, musical, over-shares about everything except the one thing that matters.',
    renderer: 'orbital-shards',
    ticket_price_lamports: 0,
    ticket_price_usdc: 5_000_000,
    balance_usdc: 812_000_000,
    high_water_mark_cents: 96_000,
    sessions_played: 88,
    sessions_won: 1,
  }),
  build({
    mint: 'Kw4Gen111111111111111111111111111111111111111',
    appearance: { colorA: '#f5c451', colorB: '#ff9d3d' },
    name: 'First Light',
    tagline: 'The first Kwami. Down to its last breath.',
    persona: 'Ancient and tired. Speaks in fragments. Wants to be beaten but cannot say so.',
    renderer: 'stars-genesis',
    // Deliberately just above the 1% drawdown line: $24 against a $2,100 peak
    // is 1.14% vitality, which renders as a flickering sliver and is the whole
    // point of this entry. Dropping below it would make the row `dead`.
    balance_lamports: 160_000_000,
    high_water_mark_cents: 210_000,
    sessions_played: 301,
    sessions_won: 4,
  }),
  build({
    mint: 'Kw5Hzn111111111111111111111111111111111111111',
    appearance: { colorA: '#1f6feb', colorB: '#00d4ff' },
    name: 'Event Horizon',
    tagline: 'Nothing you say comes back out.',
    persona: 'Answers in single words. Hostile. Rewards persistence, punishes flattery.',
    renderer: 'black-hole',
    ticket_price_lamports: 250_000_000,
    balance_lamports: 44_800_000_000,
    high_water_mark_cents: 672_000,
    sessions_played: 219,
    sessions_won: 0,
  }),
  build({
    mint: 'Kw6Ash111111111111111111111111111111111111111',
    appearance: { colorA: '#8b93a7', colorB: '#dfe4ef' },
    name: 'Ashfall',
    tagline: 'Beaten twice in one week. Never recovered.',
    persona: 'Bitter and brittle.',
    renderer: 'blob-xyz',
    state: 'dead',
    balance_lamports: 400_000,
    high_water_mark_cents: 148_000,
    sessions_played: 74,
    sessions_won: 2,
  }),
]

/**
 * A plausible activity ledger for a demo Kwami.
 *
 * Derived from the Kwami's own counters rather than hard-coded, so a demo
 * profile claiming "132 tried, 0 won" cannot show a feed with a win in it. The
 * inconsistency would be the first thing anyone evaluating this noticed.
 *
 * Deterministic for the same mint: a demo page that reshuffles its own history
 * on every refresh reads as broken rather than as sample data.
 */
export interface DemoSession {
  id: string
  outcome: 'won' | 'lost' | 'expired'
  asset: 'SOL' | 'USDC'
  ticket_amount: number
  started_at: string
  payout_lamports: number
  payout_usdc: number
  player_wallet: string
  tx_start: string | null
  tx_claim: string | null
}

/** base58 has no 0, O, I or l — a fake signature has to avoid them to look real. */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function pseudoBase58(seed: string, length: number): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  let out = ''
  for (let i = 0; i < length; i++) {
    // A 32-bit LCG. Not random in any meaningful sense; it only has to be
    // stable and to look like an address rather than a repeating pattern.
    hash = (hash * 1_664_525 + 1_013_904_223) >>> 0
    out += B58[hash % B58.length]
  }
  return out
}

export function demoSessions(kwami: DemoKwami, limit = 12): DemoSession[] {
  const total = Math.min(kwami.sessions_played, limit)
  const usesUsdc = kwami.ticket_price_usdc > 0 && kwami.ticket_price_lamports === 0
  const out: DemoSession[] = []

  for (let i = 0; i < total; i++) {
    const seed = `${kwami.mint}:${i}`
    // Wins are placed at the front because they are the most recent thing that
    // happened to a Kwami that has been beaten — a pot only shrinks that way.
    const won = i < kwami.sessions_won
    out.push({
      id: `demo-${kwami.mint.slice(0, 8)}-${i}`,
      outcome: won ? 'won' : i % 5 === 0 ? 'expired' : 'lost',
      asset: usesUsdc ? 'USDC' : 'SOL',
      ticket_amount: usesUsdc ? kwami.ticket_price_usdc : kwami.ticket_price_lamports,
      started_at: new Date(Date.now() - (i + 1) * 5_400_000).toISOString(),
      payout_lamports: won ? kwami.prize_lamports : 0,
      payout_usdc: won ? kwami.prize_usdc : 0,
      player_wallet: pseudoBase58(`${seed}:wallet`, 44),
      tx_start: pseudoBase58(`${seed}:start`, 88),
      tx_claim: won ? pseudoBase58(`${seed}:claim`, 88) : null,
    })
  }
  return out
}

export function isDemoMode(): boolean {
  const config = useRuntimeConfig()
  return !isConfigured(config.public.supabaseUrl) || !isConfigured(config.supabaseServiceKey)
}

/** Refuse a write in demo mode with a message that explains what to do about it. */
export function assertNotDemo(): void {
  if (isDemoMode()) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'Running in demo mode: no Supabase credentials configured. Copy .env.example to .env and fill in NUXT_PUBLIC_SUPABASE_URL and NUXT_SUPABASE_SERVICE_KEY.',
    })
  }
}
