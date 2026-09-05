import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { requireUser } from '~~/server/utils/supabase'
import { isValidAddress } from '~~/server/utils/solana'

const Body = z.object({
  walletAddress: z.string(),
  currencyCode: z.enum(['sol', 'usdc_sol']).default('sol'),
  baseCurrencyAmount: z.number().min(20).max(20_000).optional(),
  baseCurrencyCode: z.string().length(3).default('usd'),
})

/**
 * Build a signed MoonPay widget URL.
 *
 * MoonPay requires the URL to be HMAC-signed with the secret key, and the
 * signature covers the entire query string. That is what stops a page from
 * rewriting `walletAddress` after the fact and redirecting someone else's
 * purchase — so the signing has to happen here, and the wallet address has to
 * come from the authenticated session's own request rather than from a link.
 */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  const body = Body.parse(await readBody(event))
  const config = useRuntimeConfig()

  if (!isValidAddress(body.walletAddress)) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed wallet address.' })
  }
  if (!config.public.moonpayPublishableKey || !config.moonpaySecretKey) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'MoonPay is not configured. Set NUXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY and NUXT_MOONPAY_SECRET_KEY.',
    })
  }

  const isTest = (config.public.moonpayPublishableKey as string).startsWith('pk_test')
  const base = isTest ? 'https://buy-sandbox.moonpay.com' : 'https://buy.moonpay.com'

  const params = new URLSearchParams({
    apiKey: config.public.moonpayPublishableKey as string,
    currencyCode: body.currencyCode,
    walletAddress: body.walletAddress,
    baseCurrencyCode: body.baseCurrencyCode,
    // Land the user back where they were, with their new balance.
    redirectURL: `${config.public.siteUrl}/onramp/done`,
    // Locks the destination field so a phishing overlay cannot swap it.
    lockAmount: 'false',
  })
  if (body.baseCurrencyAmount) {
    params.set('baseCurrencyAmount', String(body.baseCurrencyAmount))
  }

  const query = `?${params.toString()}`
  const signature = createHmac('sha256', config.moonpaySecretKey).update(query).digest('base64')

  return {
    url: `${base}${query}&signature=${encodeURIComponent(signature)}`,
    sandbox: isTest,
  }
})
