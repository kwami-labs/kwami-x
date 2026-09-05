import { z } from 'zod'
import { PublicKey } from '@solana/web3.js'
import { assertNotDemo } from '~~/server/utils/demo'
import { requireUser, serviceClient } from '~~/server/utils/supabase'
import { connection, isValidAddress } from '~~/server/utils/solana'
import { findVaultPda } from '#shared/solana/pda'

const Body = z.object({
  draftId: z.string().uuid(),
  mint: z.string(),
  signature: z.string().min(64).max(120),
})

/**
 * Step 2 of minting: bind a draft to the mint that now exists on chain.
 *
 * The transaction signature is verified against the cluster rather than taken
 * on trust. Without that check a caller could POST any mint address and have
 * the index claim a Kwami they do not own — the chain would disagree, but the
 * arena would show it, which is enough to run a convincing scam.
 */
export default defineEventHandler(async (event) => {
  assertNotDemo()
  const user = await requireUser(event)
  const body = Body.parse(await readBody(event))
  const config = useRuntimeConfig()

  if (!isValidAddress(body.mint))
    throw createError({ statusCode: 400, statusMessage: 'Malformed mint address.' })

  const db = serviceClient()
  const { data: draft, error } = await db
    .from('kwamis')
    .select('id, author_id, state, secret_hash')
    .eq('id', body.draftId)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!draft) throw createError({ statusCode: 404, statusMessage: 'No such draft.' })
  if (draft.author_id !== user.id) throw createError({ statusCode: 403, statusMessage: 'Not your draft.' })
  if (draft.state !== 'draft')
    throw createError({ statusCode: 409, statusMessage: 'Draft was already minted.' })

  const tx = await connection().getTransaction(body.signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  if (!tx)
    throw createError({ statusCode: 404, statusMessage: 'Transaction not found or not yet confirmed.' })
  if (tx.meta?.err) throw createError({ statusCode: 400, statusMessage: 'That transaction failed on chain.' })

  // The mint must actually appear in the transaction, and the Kwami program
  // must have been invoked — otherwise this is an unrelated signature.
  const accountKeys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58())
  if (!accountKeys.includes(body.mint)) {
    throw createError({ statusCode: 400, statusMessage: 'That transaction does not involve this mint.' })
  }
  if (!accountKeys.includes(config.public.kwamiProgramId as string)) {
    throw createError({ statusCode: 400, statusMessage: 'That transaction did not call the Kwami program.' })
  }

  const [vault] = findVaultPda(
    new PublicKey(body.mint),
    new PublicKey(config.public.kwamiProgramId as string),
  )

  const { error: updateError } = await db
    .from('kwamis')
    .update({ mint: body.mint, vault: vault.toBase58(), state: 'minted' })
    .eq('id', draft.id)

  if (updateError) throw createError({ statusCode: 500, statusMessage: updateError.message })

  return { mint: body.mint, vault: vault.toBase58(), state: 'minted' }
})
