import { LAMPORTS_PER_SOL, USDC_BASE_UNITS } from '#shared/game/constants'

/**
 * Display formatting.
 *
 * Money in this app spans six orders of magnitude — a 0.01 SOL ticket and a
 * 4,000 USDC pot appear on the same screen — so a single fixed precision reads
 * as either noise or a rounding error depending on which end you are looking
 * at. Each formatter picks precision from magnitude instead.
 */

export function formatSol(lamports: bigint | number, opts: { symbol?: boolean } = {}): string {
  const sol = Number(lamports) / Number(LAMPORTS_PER_SOL)
  const digits = sol === 0 ? 2 : sol < 0.001 ? 5 : sol < 1 ? 3 : sol < 1000 ? 2 : 1
  const value = sol.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return opts.symbol === false ? value : `${value} SOL`
}

export function formatUsdc(baseUnits: bigint | number, opts: { symbol?: boolean } = {}): string {
  const usdc = Number(baseUnits) / Number(USDC_BASE_UNITS)
  const value = usdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return opts.symbol === false ? value : `${value} USDC`
}

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '—'
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`
  // Past five figures the cents are noise next to the magnitude; below that
  // they are the difference between two pots. Both get separators, because a
  // grid showing "$1008.00" beside "$13,191" reads as two different formats.
  if (usd >= 10_000) return `$${Math.round(usd).toLocaleString('en-US')}`
  if (usd >= 1) {
    return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `$${usd.toFixed(3)}`
}

export function formatCents(cents: number | bigint): string {
  return formatUsd(Number(cents) / 100)
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`
}

/** Truncate a base58 address for display, keeping both ends recognisable. */
export function shortAddress(address: string | null | undefined, lead = 4, tail = 4): string {
  if (!address) return '—'
  if (address.length <= lead + tail + 1) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}

/** "2 minutes ago", "in 3 hours". */
export function relativeTime(iso: string | number | Date): string {
  const then = new Date(iso).getTime()
  const deltaSecs = Math.round((then - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ]
  for (const [unit, secs] of units) {
    if (Math.abs(deltaSecs) >= secs || unit === 'second') {
      return rtf.format(Math.round(deltaSecs / secs), unit)
    }
  }
  return 'just now'
}

/** A stable colour pair derived from a Kwami's mint, so it looks the same everywhere. */
export function paletteFromMint(mint: string): { a: string; b: string } {
  let hash = 0
  for (let i = 0; i < mint.length; i++) hash = (hash * 31 + mint.charCodeAt(i)) >>> 0
  const hueA = hash % 360
  // Complementary-ish rather than exactly opposite: 140° keeps both colours
  // inside a range that stays legible against the dark surface.
  const hueB = (hueA + 140) % 360
  return { a: `hsl(${hueA} 78% 62%)`, b: `hsl(${hueB} 72% 58%)` }
}
