import { describe, expect, it } from 'vitest'
import {
  findSecretInTranscript,
  generateSalt,
  levenshtein,
  matchSecret,
  normalizePhrase,
  secretHash,
  secretPreimage,
  similarity,
  validateSecret,
  words,
} from '#shared/game/secret'

describe('normalizePhrase', () => {
  it('folds case, punctuation and spacing', () => {
    expect(normalizePhrase('  The  Moon,  Rises! ')).toBe('the moon rises')
  })

  it('strips diacritics so accents never cost a win', () => {
    expect(normalizePhrase('café ñandú')).toBe('cafe nandu')
  })

  it('keeps digits', () => {
    expect(normalizePhrase('gate 42 opens')).toBe('gate 42 opens')
  })

  it('handles non-Latin scripts without discarding them', () => {
    expect(normalizePhrase('  Привет  Мир ')).toBe('привет мир')
  })

  it('returns empty for punctuation-only input', () => {
    expect(normalizePhrase('!!! ... ???')).toBe('')
    expect(words('!!!')).toEqual([])
  })
})

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('kwami', 'kwami')).toBe(0)
  })

  it('counts single edits', () => {
    expect(levenshtein('kwami', 'kwame')).toBe(1) // substitution
    expect(levenshtein('kwami', 'kwam')).toBe(1) // deletion
    expect(levenshtein('kwami', 'kwamix')).toBe(1) // insertion
  })

  it('handles empty inputs', () => {
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
    expect(levenshtein('', '')).toBe(0)
  })

  it('is symmetric', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(levenshtein('sitting', 'kitten'))
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })
})

describe('similarity', () => {
  it('is 1 for identical and 0 for fully disjoint same-length strings', () => {
    expect(similarity('abc', 'abc')).toBe(1)
    expect(similarity('abc', 'xyz')).toBe(0)
  })

  it('treats two empty strings as identical', () => {
    expect(similarity('', '')).toBe(1)
  })
})

describe('matchSecret', () => {
  const secret = 'the moon remembers'

  it('matches an exact utterance', () => {
    expect(matchSecret('the moon remembers', secret).matched).toBe(true)
  })

  it('finds the secret buried in a sentence', () => {
    const r = matchSecret('okay let me try, is it the moon remembers, or something else?', secret)
    expect(r.matched).toBe(true)
    expect(r.matchedText).toBe('the moon remembers')
  })

  it('ignores case, punctuation and accents', () => {
    expect(matchSecret('THE MÖON, REMEMBERS!', secret).matched).toBe(true)
  })

  it('forgives a single-character transcription slip', () => {
    expect(matchSecret('the moon rememebers', secret).matched).toBe(true)
  })

  it('forgives a word-boundary split, which is how STT mangles compounds', () => {
    expect(matchSecret('the moo n remembers', secret).matched).toBe(true)
  })

  it('rejects a near-miss that is only thematically close', () => {
    expect(matchSecret('the moon forgets', secret).matched).toBe(false)
    expect(matchSecret('the sun remembers', secret).matched).toBe(false)
  })

  it('rejects someone talking about the secret without saying it', () => {
    expect(matchSecret('is your secret about the moon?', secret).matched).toBe(false)
  })

  it('rejects empty input on either side', () => {
    expect(matchSecret('', secret).matched).toBe(false)
    expect(matchSecret('anything', '').matched).toBe(false)
  })

  it('honours a stricter threshold', () => {
    expect(matchSecret('the moon rememebers', secret, { threshold: 1 }).matched).toBe(false)
  })

  it('handles single-word secrets without matching every short word', () => {
    expect(matchSecret('the answer is obsidian', 'obsidian').matched).toBe(true)
    expect(matchSecret('the answer is granite', 'obsidian').matched).toBe(false)
  })

  it('does not match a long utterance to a short secret by accident', () => {
    const r = matchSecret('one two three four five six seven eight nine ten', 'obsidian')
    expect(r.matched).toBe(false)
  })
})

describe('findSecretInTranscript', () => {
  const secret = 'velvet thunder'
  const turns = [
    { role: 'kwami', text: 'Ask me anything.', at: 0 },
    { role: 'player', text: 'Is it about weather?', at: 2_000 },
    { role: 'kwami', text: 'Maybe. Velvet thunder is a nice phrase, is it not?', at: 4_000 },
    { role: 'player', text: 'Velvet thunder!', at: 6_000 },
  ]

  it('finds the winning player turn and reports when', () => {
    const hit = findSecretInTranscript(turns, secret)
    expect(hit?.matched).toBe(true)
    expect(hit?.at).toBe(6_000)
  })

  it('never lets the Kwami win its own game by saying the secret', () => {
    const kwamiOnly = turns.filter((t) => t.role === 'kwami')
    expect(findSecretInTranscript(kwamiOnly, secret)).toBeNull()
  })

  it('returns null when nobody says it', () => {
    expect(findSecretInTranscript(turns, 'granite silence')).toBeNull()
  })
})

describe('secretHash', () => {
  it('is stable across equivalent spellings', async () => {
    const salt = 'a'.repeat(64)
    expect(await secretHash('The Moon, Remembers!', salt)).toBe(await secretHash('the moon remembers', salt))
  })

  it('changes with the salt', async () => {
    expect(await secretHash('the moon remembers', 'aa')).not.toBe(
      await secretHash('the moon remembers', 'bb'),
    )
  })

  it('is 64 hex characters', async () => {
    expect(await secretHash('the moon remembers', generateSalt())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('cannot be re-partitioned into a different secret/salt pair', () => {
    // Without the separator, ("ab", "cd") and ("abc", "d") would collide.
    expect(secretPreimage('ab', 'cd')).not.toBe(secretPreimage('abc', 'd'))
  })
})

describe('generateSalt', () => {
  it('produces 32 distinct random bytes as hex', () => {
    const a = generateSalt()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(generateSalt())
  })
})

describe('validateSecret', () => {
  it('accepts a reasonable phrase', () => {
    expect(validateSecret('the moon remembers').valid).toBe(true)
  })

  it('rejects empty and punctuation-only secrets', () => {
    expect(validateSecret('').valid).toBe(false)
    expect(validateSecret('!!!').valid).toBe(false)
  })

  it('rejects a short single word a challenger could stumble into', () => {
    expect(validateSecret('cat').valid).toBe(false)
    expect(validateSecret('moon').valid).toBe(false)
    expect(validateSecret('obsidian').valid).toBe(true)
  })

  it('rejects a phrase too long to say inside three minutes', () => {
    expect(validateSecret(Array(13).fill('word').join(' ')).valid).toBe(false)
    expect(validateSecret('x'.repeat(200)).valid).toBe(false)
  })
})
