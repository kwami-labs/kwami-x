/**
 * Sign In With Ethereum (EIP-4361) for MetaMask.
 *
 * Kwami's money lives on Solana, so an Ethereum wallet is an *identity* only —
 * it can log you in and carry your profile, but it can never hold a Kwami or
 * receive a payout. The UI has to say so at the point of connection, otherwise
 * someone signs in with MetaMask and then cannot understand why they have no
 * balance.
 *
 * The format is deliberately close to SIWS but not identical; EIP-4361 is the
 * normative spec and wallets render it specially.
 */

export interface SiweMessage {
  domain: string
  address: string
  statement?: string
  uri: string
  version: string
  chainId: number
  nonce: string
  issuedAt: string
  expirationTime?: string
}

export const SIWE_VERSION = '1'
export const SIWE_TTL_MS = 5 * 60 * 1000

export const SIWE_STATEMENT =
  'Sign in to Kwami with your Ethereum wallet. This is for identity only — Kwami pots settle on Solana.'

export function formatSiweMessage(m: SiweMessage): string {
  const lines = [`${m.domain} wants you to sign in with your Ethereum account:`, m.address]
  if (m.statement) lines.push('', m.statement)
  lines.push(
    '',
    `URI: ${m.uri}`,
    `Version: ${m.version}`,
    `Chain ID: ${m.chainId}`,
    `Nonce: ${m.nonce}`,
    `Issued At: ${m.issuedAt}`,
  )
  if (m.expirationTime) lines.push(`Expiration Time: ${m.expirationTime}`)
  return lines.join('\n')
}

export function parseSiweMessage(text: string): SiweMessage | null {
  const lines = text.split('\n')
  const header = lines[0]?.match(/^(.+) wants you to sign in with your Ethereum account:$/)
  const address = lines[1]
  if (!header || !address) return null

  const field = (label: string) => lines.find((l) => l.startsWith(`${label}: `))?.slice(label.length + 2)

  const uri = field('URI')
  const version = field('Version')
  const chainId = field('Chain ID')
  const nonce = field('Nonce')
  const issuedAt = field('Issued At')
  if (!uri || !version || !chainId || !nonce || !issuedAt) return null

  const uriIndex = lines.findIndex((l) => l.startsWith('URI: '))
  const statementLines = lines.slice(2, uriIndex).filter((l) => l.trim() !== '')

  return {
    domain: header[1],
    address,
    statement: statementLines.length ? statementLines.join('\n') : undefined,
    uri,
    version,
    chainId: Number(chainId),
    nonce,
    issuedAt,
    expirationTime: field('Expiration Time'),
  }
}

export function validateSiweMessage(
  m: SiweMessage,
  ctx: { expectedDomain: string; expectedNonce: string; now?: Date },
): { valid: boolean; reason?: string } {
  const now = ctx.now ?? new Date()
  if (m.domain !== ctx.expectedDomain) return { valid: false, reason: 'Domain mismatch.' }
  if (m.version !== SIWE_VERSION) return { valid: false, reason: 'Unsupported SIWE version.' }
  if (m.nonce !== ctx.expectedNonce) return { valid: false, reason: 'Nonce mismatch or already used.' }

  const issuedAt = Date.parse(m.issuedAt)
  if (Number.isNaN(issuedAt)) return { valid: false, reason: 'Malformed Issued At.' }
  if (now.getTime() - issuedAt > SIWE_TTL_MS) return { valid: false, reason: 'Sign-in request expired.' }
  return { valid: true }
}

/**
 * The EIP-191 `personal_sign` prefix, as a string.
 *
 * Callers prepend `EIP191_PREFIX_BYTE` themselves when hashing — keeping the control byte
 * out of this source file makes it survive copy-paste and diff tooling intact.
 */
export const EIP191_PREFIX_BYTE = 0x19

export function eip191Preamble(messageLength: number): string {
  return `Ethereum Signed Message:\n${messageLength}`
}
