/**
 * Demo dataset.
 *
 * Served whenever Supabase credentials are absent, so `bun run dev` on a fresh
 * clone produces a working, explorable arena instead of a wall of 500s. Every
 * response that comes from here carries `demo: true`, and every mutating route
 * refuses to run in demo mode — the goal is to make the app legible before
 * infrastructure exists, not to let someone believe they minted something.
 */

export interface DemoKwami {
  id: string
  mint: string
  vault: string
  name: string
  tagline: string
  persona: string
  renderer: string
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

function build(partial: Partial<DemoKwami> & Pick<DemoKwami, 'mint' | 'name' | 'tagline' | 'renderer'>): DemoKwami {
  const lamports = partial.balance_lamports ?? 0
  const usdc = partial.balance_usdc ?? 0
  const cents = Math.round(((lamports / 1e9) * SOL_USD + usdc / 1e6) * 100)
  const hwm = partial.high_water_mark_cents ?? cents
  const payoutBps = partial.payout_bps ?? 8000

  return {
    id: partial.mint,
    vault: `vault${partial.mint.slice(0, 38)}`,
    persona: '',
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
    name: 'First Light',
    tagline: 'The first Kwami. Down to its last breath.',
    persona: 'Ancient and tired. Speaks in fragments. Wants to be beaten but cannot say so.',
    renderer: 'stars-genesis',
    balance_lamports: 62_000_000,
    high_water_mark_cents: 210_000,
    sessions_played: 301,
    sessions_won: 4,
  }),
  build({
    mint: 'Kw5Hzn111111111111111111111111111111111111111',
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
 * Placeholder values that mean "not configured yet".
 *
 * `.env.example` ships with illustrative values, and the overwhelmingly common
 * first run is `cp .env.example .env` followed by starting the server. Treating
 * those literal placeholders as real credentials produces a `fetch failed`
 * against `your-project.supabase.co`, which is a far worse first impression
 * than the demo arena.
 */
function isConfigured(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false
  return !/your-project|your-server|\.{3}$|^(sk|pk|sb)_(test|publishable|secret)_\.{3}$/.test(value)
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
