/**
 * Sign In With Solana (SIWS) message construction and parsing.
 *
 * Lives in `shared/` because the client builds the message and the server
 * re-derives it from the parsed fields before checking the signature. If the
 * two ever disagreed on so much as a newline, every login would fail — or
 * worse, the server would verify a signature over a message the user never
 * actually saw.
 *
 * The wire format follows CAIP-122 / the SIWS draft, which is what Phantom's
 * `signIn` renders natively.
 */

export interface SiwsMessage {
  domain: string
  address: string
  statement?: string
  uri: string
  version: string
  chainId: string
  nonce: string
  issuedAt: string
  expirationTime?: string
  resources?: string[]
}

export const SIWS_VERSION = '1'

/** Nonces live for five minutes — long enough to read the prompt, short enough to matter. */
export const SIWS_TTL_MS = 5 * 60 * 1000

/**
 * Render a SIWS message.
 *
 * The layout is byte-exact and order-sensitive: the wallet displays these
 * lines to the user and signs them verbatim.
 */
export function formatSiwsMessage(m: SiwsMessage): string {
  const lines: string[] = [`${m.domain} wants you to sign in with your Solana account:`, m.address]

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
  if (m.resources?.length) {
    lines.push('Resources:')
    for (const r of m.resources) lines.push(`- ${r}`)
  }

  return lines.join('\n')
}

/**
 * Parse a rendered SIWS message back into fields.
 *
 * Returns `null` on anything malformed rather than throwing, so a hostile
 * client cannot turn a parse failure into a 500.
 */
export function parseSiwsMessage(text: string): SiwsMessage | null {
  const lines = text.split('\n')
  const header = lines[0]?.match(/^(.+) wants you to sign in with your Solana account:$/)
  const address = lines[1]
  if (!header || !address) return null

  const field = (label: string): string | undefined => {
    const line = lines.find((l) => l.startsWith(`${label}: `))
    return line?.slice(label.length + 2)
  }

  const uri = field('URI')
  const version = field('Version')
  const chainId = field('Chain ID')
  const nonce = field('Nonce')
  const issuedAt = field('Issued At')
  if (!uri || !version || !chainId || !nonce || !issuedAt) return null

  // Everything between the address and the blank line before `URI:` is the
  // statement, when one is present.
  const uriIndex = lines.findIndex((l) => l.startsWith('URI: '))
  const statementLines = lines.slice(2, uriIndex).filter((l) => l.trim() !== '')
  const statement = statementLines.length ? statementLines.join('\n') : undefined

  const resourcesIndex = lines.findIndex((l) => l === 'Resources:')
  const resources =
    resourcesIndex >= 0
      ? lines
          .slice(resourcesIndex + 1)
          .filter((l) => l.startsWith('- '))
          .map((l) => l.slice(2))
      : undefined

  return {
    domain: header[1]!,
    address,
    statement,
    uri,
    version,
    chainId,
    nonce,
    issuedAt,
    expirationTime: field('Expiration Time'),
    resources,
  }
}

export interface SiwsValidationContext {
  /**
   * Domain(s) this deployment answers on.
   *
   * Accept a list so local tunnels and `127.0.0.1` vs `localhost` do not fail
   * a signature that Phantom correctly bound to the host the user actually saw.
   */
  expectedDomain: string | readonly string[]
  expectedNonce: string
  expectedAddress?: string
  /** When set, the signed Chain ID must match (Phantom SIWS values). */
  expectedChainId?: string
  now?: Date
}

export interface SiwsValidation {
  valid: boolean
  reason?: string
}

/**
 * Check everything about a SIWS message except the signature itself.
 *
 * Splitting this out from signature verification keeps the rules testable
 * without needing a real keypair, and makes the failure reasons specific
 * enough to debug a broken login.
 */
export function validateSiwsMessage(m: SiwsMessage, ctx: SiwsValidationContext): SiwsValidation {
  const now = ctx.now ?? new Date()

  const domains = typeof ctx.expectedDomain === 'string' ? [ctx.expectedDomain] : ctx.expectedDomain
  if (!domains.includes(m.domain)) {
    // The wallet showed the user *this* domain. A mismatch means the signature
    // was farmed on another site and replayed here.
    return { valid: false, reason: 'Domain mismatch.' }
  }
  if (m.version !== SIWS_VERSION) return { valid: false, reason: 'Unsupported SIWS version.' }
  if (ctx.expectedChainId && m.chainId !== ctx.expectedChainId) {
    return { valid: false, reason: 'Chain ID mismatch.' }
  }
  if (m.nonce !== ctx.expectedNonce) return { valid: false, reason: 'Nonce mismatch or already used.' }
  if (ctx.expectedAddress && m.address !== ctx.expectedAddress) {
    return { valid: false, reason: 'Address mismatch.' }
  }

  const issuedAt = Date.parse(m.issuedAt)
  if (Number.isNaN(issuedAt)) return { valid: false, reason: 'Malformed Issued At.' }
  // A little slack for clock skew between the user's machine and the server.
  if (issuedAt > now.getTime() + 60_000) return { valid: false, reason: 'Issued in the future.' }
  if (now.getTime() - issuedAt > SIWS_TTL_MS) return { valid: false, reason: 'Sign-in request expired.' }

  if (m.expirationTime) {
    const exp = Date.parse(m.expirationTime)
    if (Number.isNaN(exp)) return { valid: false, reason: 'Malformed Expiration Time.' }
    if (now.getTime() >= exp) return { valid: false, reason: 'Sign-in request expired.' }
  }

  return { valid: true }
}

/**
 * Chain IDs written into SIWS messages.
 *
 * These are the values Phantom's `signIn` accepts (see the SIWS ABNF:
 * `mainnet` / `devnet` / `localnet` / `solana:mainnet` / …). Genesis-hash
 * CAIP-2 ids look right on paper but Phantom rejects them, which breaks the
 * one-click path and forces every login through the worse connect+signMessage
 * fallback — or fails outright when `signIn` is present but finicky.
 */
export const SOLANA_CHAIN_IDS = {
  'mainnet-beta': 'mainnet',
  devnet: 'devnet',
  localnet: 'localnet',
} as const

export const SIWS_STATEMENT =
  'Sign in to Kwami. This proves you control this wallet. It does not approve any transaction or move any funds.'
