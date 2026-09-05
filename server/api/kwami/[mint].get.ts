import { DEMO_KWAMIS, demoSessions, isDemoMode } from '~~/server/utils/demo'
import { serviceClient } from '~~/server/utils/supabase'
import { isValidAddress } from '~~/server/utils/solana'

/**
 * One Kwami, with everything the detail and play pages need.
 *
 * Never selects from `kwamis` directly — only from `kwamis_public`, the view
 * with no secret columns. A `select('*')` against the base table is one typo
 * away from serving a secret hash and its salt in the same payload.
 */
export default defineEventHandler(async (event) => {
  const mint = getRouterParam(event, 'mint')
  if (!mint) throw createError({ statusCode: 400, statusMessage: 'Missing mint.' })

  if (isDemoMode()) {
    const kwami = DEMO_KWAMIS.find((k) => k.mint === mint)
    if (!kwami) throw createError({ statusCode: 404, statusMessage: 'No such Kwami.' })
    return { demo: true, kwami, recentSessions: demoSessions(kwami) }
  }

  if (!isValidAddress(mint)) throw createError({ statusCode: 400, statusMessage: 'Malformed mint address.' })

  const db = serviceClient()
  const { data: kwami, error } = await db.from('kwamis_public').select('*').eq('mint', mint).maybeSingle()
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!kwami) throw createError({ statusCode: 404, statusMessage: 'No such Kwami.' })

  // Outcomes, wallets and transaction signatures — never transcripts. Showing
  // how previous challengers probed a Kwami would hand every later player a
  // free map of what has been tried; showing *that* they played, from which
  // address and for how much, is already public on chain and is the whole
  // reason a pot is credible.
  const { data: recent } = await db
    .from('game_sessions')
    .select(
      'id, outcome, asset, ticket_amount, started_at, payout_lamports, payout_usdc, player_wallet, tx_start, tx_claim',
    )
    .eq('kwami_mint', mint)
    .order('started_at', { ascending: false })
    .limit(25)

  return { demo: false, kwami, recentSessions: recent ?? [] }
})
