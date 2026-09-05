import { PublicKey } from '@solana/web3.js'
import { assertNotDemo } from '~~/server/utils/demo'
import { serviceClient } from '~~/server/utils/supabase'
import { connection, isValidAddress } from '~~/server/utils/solana'
import { decodeKwamiAccount } from '#shared/solana/accounts'
import { findKwamiPda } from '#shared/solana/pda'

/**
 * Copy a Kwami's on-chain state into the index.
 *
 * Publishing was a hole in the product: `manage.vue` sent the `publish` instruction, waited for
 * confirmation, and then only refreshed the page. Nothing told the server, so `kwamis.state`
 * stayed `minted`, the arena never listed the Kwami, and `session/start.post.ts` refused every
 * ticket. A Kwami could be Live on chain and unplayable in the app, indefinitely. Ownership had
 * the same problem in reverse: `owner_wallet` was written once at draft, so after a marketplace
 * sale the app still showed the seller as owner.
 *
 * Deliberately **permissionless and read-only with respect to the caller**. It takes no body,
 * trusts nothing it is told, and writes only what it read from the cluster — so there is no
 * authorisation to get wrong, and a buyer is never locked out by a seller who declines to call
 * it. That is the same reasoning as the program's own `sync_owner`.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const mint = getRouterParam(event, 'mint')!

  if (!isValidAddress(mint)) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed mint address.' })
  }

  const config = useRuntimeConfig()
  const program = new PublicKey(config.public.kwamiProgramId as string)
  const [pda] = findKwamiPda(new PublicKey(mint), program)

  const info = await connection().getAccountInfo(pda, 'confirmed')
  if (!info) {
    throw createError({ statusCode: 404, statusMessage: 'This Kwami does not exist on chain yet.' })
  }
  if (!info.owner.equals(program)) {
    // A PDA at the expected address owned by something else is not our account.
    throw createError({ statusCode: 409, statusMessage: 'That account is not owned by the Kwami program.' })
  }

  const account = decodeKwamiAccount(new Uint8Array(info.data))

  const db = serviceClient()
  const { data: row, error } = await db
    .from('kwamis')
    .select('id, state, owner_wallet')
    .eq('mint', mint)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No such Kwami in the index.' })

  // `draft` means the mint was never confirmed; that is confirm.post.ts's job, not this one.
  if (row.state === 'draft') {
    throw createError({ statusCode: 409, statusMessage: 'Confirm the mint before syncing.' })
  }

  const changed = row.state !== account.state || row.owner_wallet !== account.owner
  if (changed) {
    const { error: writeError } = await db
      .from('kwamis')
      .update({ state: account.state, owner_wallet: account.owner })
      .eq('id', row.id)
    if (writeError) throw createError({ statusCode: 500, statusMessage: writeError.message })
  }

  return {
    mint,
    changed,
    state: account.state,
    owner: account.owner,
    sessionsPlayed: Number(account.sessionsPlayed),
    sessionsWon: Number(account.sessionsWon),
  }
})
