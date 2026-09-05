import { z } from 'zod'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { verifySignedSiws } from '~~/server/utils/siws-verify'
import { isDemoMode } from '~~/server/utils/demo'

const Body = z.object({
  message: z.string().min(1).max(4000),
  signature: z.string().min(1).max(200),
  address: z.string().min(32).max(48),
})

interface WalletRow {
  chain: 'solana' | 'ethereum'
  address: string
  is_primary: boolean
}

/**
 * The wallets bound to the signed-in account.
 *
 * GET lists them. POST proves one and adds it.
 *
 * The two verbs share a file because they share the invariant that matters: an
 * address is only ever written here after a signature over a fresh nonce has
 * been checked. Someone who signs in with email and later connects Phantom is
 * making a claim the server has no other way to test — the browser saying
 * "this is my address" is worth nothing when the reward for a false claim is
 * another user's payouts landing in your wallet.
 *
 * A Solana address maps to exactly one account, enforced by a unique index. If
 * an address is already bound elsewhere the bind is refused rather than moved:
 * silently re-pointing it would let anyone with the private key take over the
 * payout destination of an account they do not otherwise control.
 */
export default defineEventHandler(async (event) => {
  // Demo mode has no database to bind anything into. Returning an empty list
  // rather than throwing keeps the arena explorable on a fresh clone — the UI
  // simply never shows a bound wallet.
  if (isDemoMode()) return { demo: true, wallets: [] as WalletRow[] }

  const user = await requireUser(event)
  const db = serviceClient()

  if (event.method === 'GET') {
    const { data, error } = await db
      .from('wallet_identities')
      .select('chain, address, is_primary')
      .eq('user_id', user.id)
      .order('is_primary', { ascending: false })

    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    return { wallets: shape(data as WalletRow[] | null) }
  }

  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed.' })
  }

  const body = Body.parse(await readBody(event))
  const { address } = await verifySignedSiws(body)
  const lookupKey = address.toLowerCase()

  const { data: existing } = await db
    .from('wallet_identities')
    .select('user_id')
    .eq('chain', 'solana')
    .eq('address_lower', lookupKey)
    .maybeSingle()

  if (existing && existing.user_id !== user.id) {
    throw createError({
      statusCode: 409,
      statusMessage: 'That wallet is already bound to another Kwami account.',
    })
  }

  if (!existing) {
    // The first Solana wallet on an account becomes the primary one — the
    // address the app assumes when it needs somewhere to send money and the
    // user has not said otherwise.
    const { count } = await db
      .from('wallet_identities')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('chain', 'solana')

    const { error: insertError } = await db.from('wallet_identities').insert({
      user_id: user.id,
      chain: 'solana',
      address,
      address_lower: lookupKey,
      is_primary: (count ?? 0) === 0,
    })
    if (insertError && !insertError.message.includes('duplicate')) {
      throw createError({ statusCode: 500, statusMessage: insertError.message })
    }
  }

  // Keep the auth user's metadata in step, so anything reading the JWT sees the
  // same payout address the table holds without a second query.
  await db.auth.admin.updateUserById(user.id, {
    user_metadata: { wallet_address: address, wallet_chain: 'solana' },
  })

  const { data } = await db
    .from('wallet_identities')
    .select('chain, address, is_primary')
    .eq('user_id', user.id)
    .order('is_primary', { ascending: false })

  return { wallets: shape(data as WalletRow[] | null) }
})

function shape(rows: WalletRow[] | null) {
  return (rows ?? []).map((w) => ({ chain: w.chain, address: w.address, isPrimary: w.is_primary }))
}
