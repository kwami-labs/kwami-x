/** Protocol constants shared by the client, the server and the Anchor program. */

/** Basis points denominator. */
export const BPS_DENOMINATOR = 10_000

/** Winner takes 80% of the pot. */
export const DEFAULT_PAYOUT_BPS = 8_000

/** A challenge lasts three minutes. */
export const DEFAULT_SESSION_DURATION_SECS = 180

/** Hard bounds the program enforces on owner-chosen session length. */
export const MIN_SESSION_DURATION_SECS = 30
export const MAX_SESSION_DURATION_SECS = 900

/** Owner-chosen payout must stay inside this band so the game stays worth playing. */
export const MIN_PAYOUT_BPS = 5_000
export const MAX_PAYOUT_BPS = 9_500

/**
 * Death rule 1 — a Kwami dies once it has lost 99% of its high-water mark.
 * Expressed as the surviving fraction.
 */
export const DEATH_VITALITY_THRESHOLD = 0.01

/** Death rule 2 — a Kwami dies if its vault is worth less than one dollar. */
export const DEATH_FLOOR_USD = 1

/** Lamports per SOL. */
export const LAMPORTS_PER_SOL = 1_000_000_000n

/** USDC has six decimals on Solana. */
export const USDC_DECIMALS = 6
export const USDC_BASE_UNITS = 1_000_000n

/** Protocol fee on every ticket, in basis points (2.5%). */
export const PROTOCOL_FEE_BPS = 250

/** Share of the protocol fee routed to the original author as a royalty (40% of the fee). */
export const AUTHOR_ROYALTY_BPS_OF_FEE = 4_000

/** Minimum ticket price, so the fee split never rounds to dust. */
export const MIN_TICKET_USD = 0.5

/**
 * Royalty on secondary NFT sales, in basis points of the sale price.
 *
 * Set to the same 1% the author earns on every ticket, so the incentive to
 * seed a Kwami well is identical whether it is played or flipped. Written into
 * the Metaplex metadata at mint and therefore immutable.
 */
export const SECONDARY_ROYALTY_BPS = 100

/**
 * Platform commission charged once, at mint, in SOL.
 *
 * A flat fee rather than a share of the pot: minting is where the platform's
 * real costs land — rent for the mint, the metadata account, the Kwami account
 * and its vault, plus the program deploy the owner's extension may need — and
 * those costs do not scale with how popular the Kwami later becomes. Taking it
 * as a percentage of a pot that does not exist yet would charge nothing for the
 * expensive part and everything for the cheap one.
 *
 * Overridable per deployment through `NUXT_PUBLIC_MINT_COMMISSION_SOL`.
 */
export const DEFAULT_MINT_COMMISSION_SOL = 0.5

/** The same figure in lamports, which is what the transaction actually carries. */
export const DEFAULT_MINT_COMMISSION_LAMPORTS = 500_000_000n

/**
 * Convert a configured SOL commission into lamports.
 *
 * Goes through a string rather than `value * 1e9` because the configured value
 * arrives as a decimal (`0.5`, `0.05`, `1.25`) and float multiplication of a
 * decimal by a billion is not exact — `0.29 * 1e9` is `289999999.99999994`,
 * which `BigInt()` refuses outright. Rounding fixes the crash but silently
 * shifts the fee; parsing the decimal digits directly does neither.
 */
export function commissionToLamports(sol: number | string): bigint {
  const text = typeof sol === 'number' ? sol.toFixed(9) : sol.trim()
  if (!/^\d+(\.\d+)?$/.test(text)) return 0n
  const [whole = '0', fraction = ''] = text.split('.')
  const nineDigits = fraction.padEnd(9, '0').slice(0, 9)
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(nineDigits)
}
