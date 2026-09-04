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
