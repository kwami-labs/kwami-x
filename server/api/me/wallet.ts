import { z } from 'zod'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { siwsExpectedDomains, verifySignedSiws } from '~~/server/utils/siws-verify'
import { isDemoMode } from '~~/server/utils/demo'
import { isPlaceholderEmail } from '#shared/auth/profile'
import type { SupabaseClient } from '@supabase/supabase-js'

const Body = z.object({
  message: z.string().min(1).max(4000),
  signature: z.string().min(1).max(200),
  address: z.string().min(32).max(48),
  /** Make this the payout destination even if another wallet already is. */
  makePrimary: z.boolean().optional(),
})

const Unlink = z.object({ address: z.string().min(32).max(48) })

interface WalletRow {
  chain: 'solana' | 'ethereum'
  address: string
  address_lower: string
  is_primary: boolean
}

/**
 * The wallets bound to the signed-in account.
 *
 * GET lists them. POST proves one and adds it. DELETE unlinks one.
 *
 * The verbs share a file because they share the invariant that matters: an
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
 *
 * Choosing the payout wallet goes through POST rather than a cheaper PATCH,
 * because it costs money to get wrong. Re-proving the signature means the
 * request cannot be forged by a page the user was tricked into loading.
 */
export default defineEventHandler(async (event) => {
  // Demo mode has no database to bind anything into. Returning an empty list
  // rather than throwing keeps the arena explorable on a fresh clone — the UI
  // simply never shows a bound wallet.
  if (isDemoMode()) return { demo: true, wallets: [] as ReturnType<typeof shape> }

  const user = await requireUser(event)
  const db = serviceClient()

  if (event.method === 'GET') return { wallets: shape(await list(db, user.id)) }

  if (event.method === 'DELETE') {
    const { address } = Unlink.parse(getQuery(event))

    // Unlinking the only wallet on an account that signed in *with* that wallet
    // is a locked door: the next sign-in cannot find the identity row, and
    // re-creating the user collides with the synthetic email still on file. So
    // the wallet may only be given up once there is another way in.
    const owned = await list(db, user.id)
    const lastWayIn =
      owned.length <= 1 &&
      owned.some((w) => w.address_lower === address.toLowerCase()) &&
      isPlaceholderEmail(user.email)
    if (lastWayIn) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Add an email and password first — this wallet is the only way into this account.',
      })
    }

    const { error } = await db
      .from('wallet_identities')
      .delete()
      .eq('user_id', user.id)
      .eq('address_lower', address.toLowerCase())
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })

    // Unlinking the payout wallet must not leave the account pointing at a
    // wallet it no longer claims: the metadata copy is what anything reading
    // the JWT pays. Promote whatever is left, or clear it.
    await syncPrimary(db, user.id, null, true)
    return { wallets: shape(await list(db, user.id)) }
  }

  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed.' })
  }

  const body = Body.parse(await readBody(event))
  const { address } = await verifySignedSiws(body, { expectedDomains: siwsExpectedDomains(event) })
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
    const { error: insertError } = await db.from('wallet_identities').insert({
      user_id: user.id,
      chain: 'solana',
      address,
      address_lower: lookupKey,
      is_primary: false,
    })
    if (insertError && !insertError.message.includes('duplicate')) {
      throw createError({ statusCode: 500, statusMessage: insertError.message })
    }
  }

  // The first Solana wallet on an account becomes the payout destination
  // whether or not it was asked for — an account with money owed and no
  // address to send it to is the worse default.
  await syncPrimary(db, user.id, lookupKey, body.makePrimary === true)

  return { wallets: shape(await list(db, user.id)) }
})

function list(db: SupabaseClient, userId: string) {
  return db
    .from('wallet_identities')
    .select('chain, address, address_lower, is_primary')
    .eq('user_id', userId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .then(({ data, error }) => {
      if (error) throw createError({ statusCode: 500, statusMessage: error.message })
      return (data ?? []) as WalletRow[]
    })
}

/**
 * Settle which Solana wallet is primary and mirror it onto the auth user.
 *
 * `wallet_identities.is_primary` is the record; `user_metadata.wallet_address`
 * is a cache of it that exists so anything holding the JWT can read the payout
 * address without a query. They are written together here, and nowhere else, so
 * they cannot drift into disagreeing about where money goes.
 */
async function syncPrimary(
  db: SupabaseClient,
  userId: string,
  preferLower: string | null,
  force: boolean,
): Promise<void> {
  const solana = (await list(db, userId)).filter((w) => w.chain === 'solana')
  const current = solana.find((w) => w.is_primary)
  if (current && !force) return

  const target = (preferLower && solana.find((w) => w.address_lower === preferLower)) || solana[0] || null
  if (current?.address_lower === target?.address_lower && current) return

  if (current) {
    await db
      .from('wallet_identities')
      .update({ is_primary: false })
      .eq('user_id', userId)
      .eq('chain', 'solana')
      .eq('is_primary', true)
  }
  if (target) {
    await db
      .from('wallet_identities')
      .update({ is_primary: true })
      .eq('user_id', userId)
      .eq('chain', 'solana')
      .eq('address_lower', target.address_lower)
  }

  await db.auth.admin.updateUserById(userId, {
    user_metadata: {
      wallet_address: target?.address ?? null,
      wallet_chain: target ? 'solana' : null,
    },
  })
}

function shape(rows: WalletRow[]) {
  return rows.map((w) => ({ chain: w.chain, address: w.address, isPrimary: w.is_primary }))
}
