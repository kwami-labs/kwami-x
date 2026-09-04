/**
 * Secret phrase handling: normalisation, fuzzy spoken matching and the
 * commitment hash that the Solana program verifies.
 *
 * The hard problem here is that speech-to-text is lossy. A player who *did*
 * say the secret may have it come back with different casing, punctuation,
 * accents or a one-character slip. Matching has to be forgiving enough that a
 * genuine win is never denied, and strict enough that "uh, is it maybe about
 * the moon?" does not accidentally unlock a pot.
 *
 * The compromise: normalise aggressively, then require a near-exact match of
 * the secret *as a contiguous run of words inside the utterance*.
 */

/** Combining diacritical marks, stripped after NFD decomposition. */
const COMBINING_MARKS = /[\u0300-\u036f]/g

/** Unit separator — cannot occur in a normalised phrase, so it is a safe delimiter. */
const SEPARATOR = '\u001f'

/** A phrase reduced to its comparable core. */
export function normalizePhrase(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    // Keep letters, digits and spaces; everything else becomes a separator.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Split a normalised phrase into words. */
export function words(input: string): string[] {
  const n = normalizePhrase(input)
  return n.length === 0 ? [] : n.split(' ')
}

/**
 * Levenshtein edit distance, iterative with a single rolling row.
 *
 * O(a·b) time, O(b) space — the strings here are short phrases, so this is
 * comfortably cheaper than pulling in a dependency.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let curr = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    const swap = prev
    prev = curr
    curr = swap
  }
  return prev[b.length]
}

/** Normalised similarity in [0, 1]; 1 means identical. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length)
  if (longest === 0) return 1
  return 1 - levenshtein(a, b) / longest
}

export interface MatchOptions {
  /**
   * Minimum similarity for a window to count as the secret.
   *
   * 0.88 tolerates roughly one wrong character per eight — enough to absorb a
   * plural, a dropped article or a homophone slip, not enough to let an
   * unrelated phrase through.
   */
  threshold?: number
  /**
   * Allow the spoken run to be one word longer or shorter than the secret,
   * which is how STT usually mangles compound words ("moonlight" -> "moon light").
   */
  slack?: number
}

export interface MatchResult {
  matched: boolean
  /** Best similarity found across all candidate windows. */
  score: number
  /** The span of the utterance that matched, for the transcript UI. */
  matchedText?: string
}

export const DEFAULT_MATCH_THRESHOLD = 0.88
const DEFAULT_SLACK = 1

/**
 * Does `utterance` contain `secret`?
 *
 * Slides every window of `secretWordCount ± slack` words across the utterance
 * and keeps the best similarity. Windows are compared with spaces removed, so
 * word-boundary disagreements between the two ("sun flower" vs "sunflower")
 * cost nothing.
 */
export function matchSecret(utterance: string, secret: string, options: MatchOptions = {}): MatchResult {
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD
  const slack = options.slack ?? DEFAULT_SLACK

  const secretWords = words(secret)
  const uttWords = words(utterance)
  if (secretWords.length === 0) return { matched: false, score: 0 }
  if (uttWords.length === 0) return { matched: false, score: 0 }

  const target = secretWords.join('')
  let best = 0
  let bestText: string | undefined

  const minLen = Math.max(1, secretWords.length - slack)
  const maxLen = Math.min(uttWords.length, secretWords.length + slack)

  for (let len = minLen; len <= maxLen; len++) {
    for (let start = 0; start + len <= uttWords.length; start++) {
      const window = uttWords.slice(start, start + len)
      const score = similarity(window.join(''), target)
      if (score > best) {
        best = score
        bestText = window.join(' ')
      }
    }
  }

  return { matched: best >= threshold, score: best, matchedText: bestText }
}

/** Scan a transcript in order and report the first winning player turn. */
export function findSecretInTranscript(
  turns: Array<{ role: string; text: string; at: number }>,
  secret: string,
  options?: MatchOptions,
): (MatchResult & { at: number }) | null {
  for (const turn of turns) {
    if (turn.role !== 'player') continue
    const result = matchSecret(turn.text, secret, options)
    if (result.matched) return { ...result, at: turn.at }
  }
  return null
}

/**
 * Canonical pre-image for the on-chain commitment.
 *
 * The unit separator can never appear in a normalised phrase, so the secret
 * and the salt cannot be re-partitioned into a different pair that hashes the
 * same way.
 */
export function secretPreimage(secret: string, salt: string): string {
  return `${normalizePhrase(secret)}${SEPARATOR}${salt}`
}

/**
 * `sha256(normalize(secret) || 0x1f || salt)` as lowercase hex.
 *
 * The Anchor program computes the identical digest over the same bytes, so a
 * pre-image produced here verifies on chain without further encoding.
 */
export async function secretHash(secret: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(secretPreimage(secret, salt))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return toHex(new Uint8Array(digest))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** A 32-byte random salt as hex — high entropy, so the hash cannot be brute-forced. */
export function generateSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)))
}

/**
 * Reject secrets that would make the game unfair or unwinnable.
 *
 * Too short and a challenger stumbles into it by accident; too long and no
 * one can say it inside three minutes.
 */
export function validateSecret(secret: string): { valid: boolean; reason?: string } {
  const w = words(secret)
  if (w.length === 0) return { valid: false, reason: 'Secret cannot be empty.' }
  const normalized = w.join(' ')
  if (normalized.length < 4) return { valid: false, reason: 'Secret must be at least 4 characters once normalised.' }
  if (normalized.length > 120) return { valid: false, reason: 'Secret must be at most 120 characters.' }
  if (w.length > 12) return { valid: false, reason: 'Secret must be at most 12 words — it has to be speakable.' }
  if (w.length === 1 && w[0].length < 5) {
    return { valid: false, reason: 'A single-word secret must be at least 5 characters.' }
  }
  return { valid: true }
}
