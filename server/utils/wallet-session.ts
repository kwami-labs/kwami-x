import { createClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'
import { serviceClient } from './supabase'
import { toChecksumAddress } from './eth'

export type WalletChain = 'solana' | 'ethereum'

export interface WalletSessionInput {
  chain: WalletChain
  address: string
}

/**
 * Turn a proven wallet signature into a real Supabase session.
 *
 * Supabase has no first-class "sign in as this wallet" primitive, so the flow
 * is: look the wallet up in `wallet_identities`, create the auth user on first
 * sight, then mint a session for it through the admin magic-link + `verifyOtp`
 * pair. The link is never emailed — it is generated and immediately redeemed
 * server-side, which is the supported way to issue a session for an identity
 * the application has already authenticated itself.
 *
 * The result is that a wallet user is an ordinary Supabase user: the same JWT,
 * the same row level security policies, and the option to later attach an
 * email or a Google account to the *same* row rather than a parallel identity
 * system that has to be reconciled forever.
 */
export async function issueWalletSession(event: H3Event, input: WalletSessionInput) {
  const config = useRuntimeConfig()
  const admin = serviceClient()

  const address = input.chain === 'ethereum' ? toChecksumAddress(input.address) : input.address
  const lookupKey = address.toLowerCase()

  const { data: identity } = await admin
    .from('wallet_identities')
    .select('user_id, address')
    .eq('chain', input.chain)
    .eq('address_lower', lookupKey)
    .maybeSingle()

  let userId = identity?.user_id as string | undefined

  // A synthetic address is needed because Supabase keys auth users by email.
  // The domain is non-routable on purpose: nothing should ever try to deliver
  // mail to it, and a user who later adds a real email keeps this same row.
  const email = `${input.chain}-${lookupKey}@wallet.kwami.invalid`

  if (!userId) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        wallet_address: address,
        wallet_chain: input.chain,
        display_name: shortenAddress(address),
      },
    })
    if (createError || !created.user) {
      throw createError2(createError?.message ?? 'Could not create the wallet account.')
    }
    userId = created.user.id

    const { error: linkError } = await admin.from('wallet_identities').insert({
      user_id: userId,
      chain: input.chain,
      address,
      address_lower: lookupKey,
    })
    // A unique-violation here means a concurrent request won the race; that is
    // fine, the user exists either way.
    if (linkError && !linkError.message.includes('duplicate')) {
      throw createError2(linkError.message)
    }
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkError || !link.properties?.hashed_token) {
    throw createError2(linkError?.message ?? 'Could not issue a session.')
  }

  // Redeem with an anon client: `verifyOtp` returns a session only for a
  // client that does not already hold service-role credentials.
  const anon = createClient(config.public.supabaseUrl as string, config.public.supabaseAnonKey as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (verifyError || !verified.session) {
    throw createError2(verifyError?.message ?? 'Could not issue a session.')
  }

  // Mirrors what `@supabase/ssr` expects, so an SSR render picks the session up
  // on the very next request instead of flashing a signed-out shell first.
  setCookie(event, 'sb-access-token', verified.session.access_token, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    path: '/',
    maxAge: verified.session.expires_in,
  })
  setCookie(event, 'sb-refresh-token', verified.session.refresh_token, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })

  return {
    user: { id: userId, address, chain: input.chain },
    session: {
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
      expires_at: verified.session.expires_at,
    },
  }
}

function createError2(message: string) {
  return createError({ statusCode: 500, statusMessage: message })
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}
