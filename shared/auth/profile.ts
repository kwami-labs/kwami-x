/**
 * Profile field rules, shared so the browser and Postgres agree on them.
 *
 * `handle` mirrors the `handle_format` check constraint in the initial
 * migration. Validating here is not a substitute for that constraint — the
 * database stays the authority — it is what turns a raw 23514 into a sentence
 * someone can act on without opening the network tab.
 */

export const HANDLE_PATTERN = /^[a-z0-9_]{3,24}$/
export const DISPLAY_NAME_MAX = 40
export const BIO_MAX = 280

/**
 * Mailbox domain for wallet-only accounts.
 *
 * Non-routable on purpose: Supabase keys auth users by email, so a wallet
 * sign-in has to invent one, and nothing should ever try to deliver to it.
 * Shared with the client because the profile page has to tell the difference
 * between "this account has an email" and "this account has a placeholder and
 * no way back in if the wallet is lost".
 */
export const WALLET_EMAIL_DOMAIN = 'wallet.kwami.invalid'

export function walletEmail(chain: string, addressLower: string): string {
  return `${chain}-${addressLower}@${WALLET_EMAIL_DOMAIN}`
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return Boolean(email?.endsWith(`@${WALLET_EMAIL_DOMAIN}`))
}

export interface ProfileDraft {
  handle: string
  displayName: string
  bio: string
  avatarUrl: string
}

/**
 * Coerce what someone typed into what the constraint accepts.
 *
 * `@Alex`, `Alex`, and `alex smith` are all offered by people who mean the same
 * handle, and rejecting two of the three teaches nothing.
 */
export function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/** The first thing wrong with a draft, or `null` when it is saveable. */
export function validateProfile(draft: ProfileDraft): string | null {
  if (draft.handle && !HANDLE_PATTERN.test(draft.handle)) {
    return 'Handles are 3–24 characters: lowercase letters, numbers and underscores.'
  }
  if (draft.displayName.length > DISPLAY_NAME_MAX) {
    return `Keep the display name under ${DISPLAY_NAME_MAX} characters.`
  }
  if (draft.bio.length > BIO_MAX) return `Keep the bio under ${BIO_MAX} characters.`
  // https only: the avatar is rendered in an `img` on pages served over https,
  // where a plain-http source is blocked as mixed content and simply vanishes.
  if (draft.avatarUrl && !/^https:\/\/\S+$/.test(draft.avatarUrl)) {
    return 'The avatar has to be an https:// link.'
  }
  return null
}
