import { z } from 'zod'
import { siwsExpectedDomains, verifySignedSiws } from '~~/server/utils/siws-verify'

const Body = z.object({
  /** The exact message the wallet displayed. */
  message: z.string().min(1).max(4000),
  /** base58-encoded ed25519 signature. */
  signature: z.string().min(1).max(200),
  address: z.string().min(32).max(48),
})

/**
 * Exchange a signed SIWS message for a Supabase session.
 *
 * The verification itself lives in `verifySignedSiws`, shared with the route
 * that binds a wallet to an account that is already signed in — the two must
 * never drift apart, because the weaker of the pair would become the way in.
 */
export default defineEventHandler(async (event) => {
  const body = Body.parse(await readBody(event))
  const { address } = await verifySignedSiws(body, { expectedDomains: siwsExpectedDomains(event) })
  return issueWalletSession(event, { chain: 'solana', address })
})
