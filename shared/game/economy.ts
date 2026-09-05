/**
 * Pot arithmetic: ticket splits, payouts, vitality and the death rules.
 *
 * Everything here is integer math on `bigint` base units. Floating point is
 * only ever used for *display* USD values, never for a value that moves on
 * chain — the same functions run in the Anchor program, so any drift between
 * the two would be a consensus bug.
 */
import {
  AUTHOR_ROYALTY_BPS_OF_FEE,
  BPS_DENOMINATOR,
  DEATH_FLOOR_USD,
  DEATH_VITALITY_THRESHOLD,
  LAMPORTS_PER_SOL,
  PROTOCOL_FEE_BPS,
  USDC_BASE_UNITS,
} from './constants'
import type { KwamiState, VaultBalances } from '../types/kwami'

/** Multiply `amount` by `bps/10000`, rounding down. */
export function applyBps(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
    throw new RangeError(`bps out of range: ${bps}`)
  }
  return (amount * BigInt(bps)) / BigInt(BPS_DENOMINATOR)
}

export interface TicketSplit {
  /** Amount that actually lands in the Kwami's pot. */
  toVault: bigint
  /** Protocol treasury cut. */
  toProtocol: bigint
  /** Original author's royalty, carved out of the protocol fee. */
  toAuthor: bigint
}

/**
 * Split a ticket payment.
 *
 * The author royalty is carved *out of* the protocol fee rather than added on
 * top, so the total fee a challenger pays never exceeds `PROTOCOL_FEE_BPS`.
 */
export function splitTicket(ticket: bigint, feeBps = PROTOCOL_FEE_BPS): TicketSplit {
  if (ticket < 0n) throw new RangeError('ticket must be non-negative')
  const fee = applyBps(ticket, feeBps)
  const toAuthor = applyBps(fee, AUTHOR_ROYALTY_BPS_OF_FEE)
  return {
    toVault: ticket - fee,
    toProtocol: fee - toAuthor,
    toAuthor,
  }
}

export interface Payout {
  lamports: bigint
  usdcBaseUnits: bigint
}

/**
 * What a winner receives: `payoutBps` of *both* vault assets.
 *
 * Both assets are paid proportionally rather than converting between them, so
 * the program never needs a swap route or a price oracle to settle a win.
 */
export function calculatePayout(
  balances: Pick<VaultBalances, 'lamports' | 'usdcBaseUnits'>,
  payoutBps: number,
): Payout {
  return {
    lamports: applyBps(balances.lamports, payoutBps),
    usdcBaseUnits: applyBps(balances.usdcBaseUnits, payoutBps),
  }
}

/** Vault value in USD given spot prices. */
export function vaultUsd(
  balances: Pick<VaultBalances, 'lamports' | 'usdcBaseUnits'>,
  solUsd: number,
): number {
  const sol = Number(balances.lamports) / Number(LAMPORTS_PER_SOL)
  const usdc = Number(balances.usdcBaseUnits) / Number(USDC_BASE_UNITS)
  return sol * solUsd + usdc
}

/**
 * How alive a Kwami is: current value over its all-time peak, clamped to [0, 1].
 *
 * A Kwami that has never held value is considered fully vital — it has not
 * *lost* anything yet, so the 99% drawdown rule cannot have triggered.
 */
export function vitality(currentUsd: number, highWaterMarkUsd: number): number {
  if (highWaterMarkUsd <= 0) return 1
  return Math.min(1, Math.max(0, currentUsd / highWaterMarkUsd))
}

export type DeathCause = 'drawdown' | 'dust'

export interface DeathVerdict {
  dead: boolean
  cause?: DeathCause
  vitality: number
}

/**
 * The two death rules, evaluated together.
 *
 * 1. **Drawdown** — the vault has lost 99% of its high-water mark.
 * 2. **Dust** — the vault is worth less than one dollar.
 *
 * A brand-new Kwami with an empty vault is *dust-dead* by rule 2 on paper, so
 * callers pass `hasBeenFunded: false` for a Kwami that has never received a
 * ticket; an unfunded Kwami is simply not alive yet, not dead.
 */
export function evaluateDeath(
  currentUsd: number,
  highWaterMarkUsd: number,
  hasBeenFunded = true,
): DeathVerdict {
  const v = vitality(currentUsd, highWaterMarkUsd)
  if (!hasBeenFunded) return { dead: false, vitality: v }
  if (currentUsd < DEATH_FLOOR_USD) return { dead: true, cause: 'dust', vitality: v }
  if (v < DEATH_VITALITY_THRESHOLD) return { dead: true, cause: 'drawdown', vitality: v }
  return { dead: false, vitality: v }
}

/**
 * Fold a death verdict into a lifecycle state.
 *
 * `cracked` and `dead` are terminal, so a Kwami that already reached one stays
 * there even if someone later sends SOL to the vault.
 */
export function nextState(current: KwamiState, verdict: DeathVerdict): KwamiState {
  if (current === 'dead' || current === 'cracked') return current
  return verdict.dead ? 'dead' : current
}

/** Convert a USD amount into lamports at a given SOL price. */
export function usdToLamports(usd: number, solUsd: number): bigint {
  if (solUsd <= 0) throw new RangeError('solUsd must be positive')
  return BigInt(Math.round((usd / solUsd) * Number(LAMPORTS_PER_SOL)))
}

/** Convert a USD amount into USDC base units. */
export function usdToUsdcBaseUnits(usd: number): bigint {
  return BigInt(Math.round(usd * Number(USDC_BASE_UNITS)))
}
