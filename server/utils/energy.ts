import type { SupabaseClient } from '@supabase/supabase-js'
import { PublicKey } from '@solana/web3.js'
import { costOf, energyFromLamports, type EnergyOp } from '#shared/energy/cost'
import { FREE_TRIAL_MICRO, DEFAULT_ENERGY_PER_SOL } from '#shared/energy/constants'
import { commissionToLamports } from '#shared/game/constants'
import { fuelAfterCommission, resolveEnergyPerSol, treasuryDelta } from '#shared/energy/receipt'
import { connection } from './solana'
import { serviceClient } from './supabase'

/**
 * Spending and buying energy.
 *
 * Two rules run through everything here.
 *
 * **Debits are atomic in the database, never in this file.** Reading a balance
 * in Nitro and writing it back would let two concurrent replies both see the
 * same number and both succeed, and a balance that cannot actually reach zero
 * under load is not a balance — it is a decoration on an unmetered API. Every
 * debit goes through a `for update` function; see the energy migration.
 *
 * **Credits are verified against the cluster, never taken on trust.** A client
 * posting "I paid" is worth nothing when the reward for lying is free
 * inference. This is the same discipline `kwami/confirm.post.ts` already
 * applies to the mint itself, pointed at a second money path.
 */

/** Reasons the ledger records. Mirrors the `energy_reason` enum. */
export type EnergyReason = 'trial_grant' | 'mint_fuel' | 'topup' | 'reply' | 'voice' | 'codegen' | 'refund'

/** How much energy one SOL buys in this deployment. */
export function energyPerSol(): number {
  return resolveEnergyPerSol(useRuntimeConfig().public.energyPerSol, DEFAULT_ENERGY_PER_SOL)
}

/**
 * Give an account its one-off trial allowance.
 *
 * Idempotent through the primary key: a second call is a no-op rather than a
 * second grant, which is the whole reason `granted_at` is set on insert only.
 * Returns the balance either way.
 */
export async function grantTrial(userId: string, db: SupabaseClient = serviceClient()): Promise<bigint> {
  const { data: existing } = await db
    .from('account_energy')
    .select('trial_micro')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) return BigInt(existing.trial_micro)

  const { data, error } = await db
    .from('account_energy')
    .insert({
      user_id: userId,
      trial_micro: FREE_TRIAL_MICRO.toString(),
      granted_at: new Date().toISOString(),
    })
    .select('trial_micro')
    .single()

  // A duplicate key here means a concurrent request granted it first, which is
  // the correct outcome and not an error worth surfacing.
  if (error) {
    const { data: raced } = await db
      .from('account_energy')
      .select('trial_micro')
      .eq('user_id', userId)
      .maybeSingle()
    return raced ? BigInt(raced.trial_micro) : 0n
  }

  await db.from('energy_ledger').insert({
    user_id: userId,
    delta_micro: FREE_TRIAL_MICRO.toString(),
    reason: 'trial_grant',
    balance_after: FREE_TRIAL_MICRO.toString(),
  })

  return BigInt(data.trial_micro)
}

/** An account's remaining pre-mint allowance. */
export async function trialBalance(userId: string, db: SupabaseClient = serviceClient()): Promise<bigint> {
  const { data } = await db.from('account_energy').select('trial_micro').eq('user_id', userId).maybeSingle()
  return data ? BigInt(data.trial_micro) : 0n
}

/** A Kwami's balance. Zero for a Kwami that does not exist, which reads the same to a caller. */
export async function kwamiEnergy(kwamiId: string, db: SupabaseClient = serviceClient()): Promise<bigint> {
  const { data } = await db.from('kwamis').select('energy_micro').eq('id', kwamiId).maybeSingle()
  return data ? BigInt(data.energy_micro) : 0n
}

export interface SpendResult {
  /** Whether the charge went through. */
  ok: boolean
  /** The balance afterwards, or the balance that was too small to pay. */
  balance: bigint
  /** What the operation cost. */
  cost: bigint
}

/**
 * Charge a Kwami for something it just did.
 *
 * Returns rather than throws, because the two callers want different things
 * from a refusal: a session reply has to fail visibly, and a studio preview has
 * to offer the creator a top-up. Deciding that here would force one of them to
 * catch and re-interpret the other's error.
 */
export async function spendKwamiEnergy(
  kwamiId: string,
  op: EnergyOp,
  reason: EnergyReason,
  meta: Record<string, unknown> = {},
  db: SupabaseClient = serviceClient(),
): Promise<SpendResult> {
  const cost = costOf(op)
  if (cost === 0n) return { ok: true, balance: await kwamiEnergy(kwamiId, db), cost }

  const { data, error } = await db.rpc('spend_kwami_energy', {
    p_kwami_id: kwamiId,
    p_cost: cost.toString(),
    p_reason: reason,
    p_meta: meta,
  })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  // Null is the function's way of saying "could not afford it", which is a
  // normal outcome rather than a failure.
  if (data === null) return { ok: false, balance: await kwamiEnergy(kwamiId, db), cost }
  return { ok: true, balance: BigInt(data), cost }
}

/** Charge an account's pre-mint trial allowance. */
export async function spendTrialEnergy(
  userId: string,
  op: EnergyOp,
  reason: EnergyReason,
  meta: Record<string, unknown> = {},
  db: SupabaseClient = serviceClient(),
): Promise<SpendResult> {
  const cost = costOf(op)
  const { data, error } = await db.rpc('spend_trial_energy', {
    p_user_id: userId,
    p_cost: cost.toString(),
    p_reason: reason,
    p_meta: meta,
  })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (data === null) return { ok: false, balance: await trialBalance(userId, db), cost }
  return { ok: true, balance: BigInt(data), cost }
}

/** Credit a verified purchase. Idempotent on `tx`; see the migration. */
export async function creditKwamiEnergy(
  kwamiId: string,
  micro: bigint,
  reason: EnergyReason,
  tx: string | null,
  meta: Record<string, unknown> = {},
  db: SupabaseClient = serviceClient(),
): Promise<bigint> {
  if (micro <= 0n) return kwamiEnergy(kwamiId, db)

  const { data, error } = await db.rpc('credit_kwami_energy', {
    p_kwami_id: kwamiId,
    p_amount: micro.toString(),
    p_reason: reason,
    p_tx: tx,
    p_meta: meta,
  })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return data === null ? 0n : BigInt(data)
}

/**
 * How many lamports a transaction actually delivered to the platform treasury.
 *
 * Read from the treasury's own balance delta rather than by decoding
 * instructions. Decoding would have to keep up with however the bundle is
 * assembled — a transfer, a CPI, several transfers merged — whereas the balance
 * change is the thing that actually happened, and it is what the payer's wallet
 * showed them too.
 *
 * Returns 0 when no treasury is configured, which is the same "no commission
 * instruction at all" posture the mint bundle takes: a fresh clone pointed at
 * devnet must still work without inventing an address to pay.
 */
export async function treasuryReceipt(signature: string): Promise<bigint> {
  const config = useRuntimeConfig()
  const treasury = (config.public.platformTreasury as string) || ''
  if (!treasury) return 0n

  let treasuryKey: PublicKey
  try {
    treasuryKey = new PublicKey(treasury)
  } catch {
    return 0n
  }

  const tx = await connection().getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  if (!tx) {
    throw createError({ statusCode: 404, statusMessage: 'Transaction not found or not yet confirmed.' })
  }
  if (tx.meta?.err) {
    throw createError({ statusCode: 400, statusMessage: 'That transaction failed on chain.' })
  }

  // `getAccountKeys` folds in anything loaded from an address lookup table, so
  // a v0 transaction that referenced the treasury indirectly is still found.
  const keys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta?.loadedAddresses,
  })
  const index = keys.staticAccountKeys.findIndex((k) => k.equals(treasuryKey))
  return treasuryDelta(tx.meta?.preBalances, tx.meta?.postBalances, index)
}

/**
 * Credit the fuel bought inside a mint bundle.
 *
 * The bundle pays the treasury twice — the flat mint commission and then the
 * fuel — and both land in the same balance delta, so the commission has to come
 * back off before anything is credited. Subtracting it here rather than
 * recording the intended fuel amount at draft keeps the whole thing derivable
 * from the transaction itself: whatever the creator paid the treasury above the
 * advertised fee is what they were buying energy with.
 */
export async function creditMintFuel(signature: string, kwamiId: string): Promise<bigint> {
  const config = useRuntimeConfig()
  const received = await treasuryReceipt(signature)
  const commission = commissionToLamports(config.public.mintCommissionSol as string)
  const fuelLamports = fuelAfterCommission(received, commission)
  if (fuelLamports === 0n) return kwamiEnergy(kwamiId)

  const micro = energyFromLamports(fuelLamports, energyPerSol())
  return creditKwamiEnergy(kwamiId, micro, 'mint_fuel', signature, {
    lamports: fuelLamports.toString(),
  })
}

/** Credit a standalone top-up, where the whole receipt is fuel. */
export async function creditTopUp(signature: string, kwamiId: string): Promise<bigint> {
  const received = await treasuryReceipt(signature)
  if (received === 0n) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That transaction did not pay the platform treasury.',
    })
  }
  const micro = energyFromLamports(received, energyPerSol())
  if (micro <= 0n) {
    throw createError({ statusCode: 400, statusMessage: 'That payment is too small to buy any energy.' })
  }
  return creditKwamiEnergy(kwamiId, micro, 'topup', signature, { lamports: received.toString() })
}
