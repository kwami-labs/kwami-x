import { describe, expect, it } from 'vitest'
import {
  BIO_MAX,
  isPlaceholderEmail,
  normalizeHandle,
  validateProfile,
  walletEmail,
  type ProfileDraft,
} from '../../shared/auth/profile'

const draft = (over: Partial<ProfileDraft> = {}): ProfileDraft => ({
  handle: '',
  displayName: '',
  bio: '',
  avatarUrl: '',
  ...over,
})

describe('normalizeHandle', () => {
  it('accepts the shapes people actually type', () => {
    expect(normalizeHandle('  @Kwami Labs ')).toBe('kwami_labs')
    expect(normalizeHandle('kwami-labs')).toBe('kwami_labs')
    expect(normalizeHandle('@@alex')).toBe('alex')
  })

  it('leaves an already-valid handle alone', () => {
    expect(normalizeHandle('kwami_labs')).toBe('kwami_labs')
  })
})

describe('validateProfile', () => {
  it('passes an empty draft — every field is optional', () => {
    expect(validateProfile(draft())).toBeNull()
  })

  it('rejects handles the database constraint would reject', () => {
    // Anything that fails here would come back as a raw 23514 otherwise.
    expect(validateProfile(draft({ handle: 'ab' }))).toMatch(/3–24/)
    expect(validateProfile(draft({ handle: 'a'.repeat(25) }))).toMatch(/3–24/)
    expect(validateProfile(draft({ handle: 'Not_Lower' }))).toMatch(/3–24/)
    expect(validateProfile(draft({ handle: 'has space' }))).toMatch(/3–24/)
    expect(validateProfile(draft({ handle: 'ok_handle1' }))).toBeNull()
  })

  it('refuses a plain-http avatar, which would be blocked as mixed content', () => {
    expect(validateProfile(draft({ avatarUrl: 'http://x.example/a.png' }))).toMatch(/https/)
    expect(validateProfile(draft({ avatarUrl: 'https://x.example/a.png' }))).toBeNull()
  })

  it('caps the long free-text fields', () => {
    expect(validateProfile(draft({ bio: 'x'.repeat(BIO_MAX) }))).toBeNull()
    expect(validateProfile(draft({ bio: 'x'.repeat(BIO_MAX + 1) }))).toMatch(/bio/)
    expect(validateProfile(draft({ displayName: 'x'.repeat(41) }))).toMatch(/display name/)
  })
})

describe('placeholder wallet emails', () => {
  it('recognises the mailbox a wallet sign-in invents', () => {
    // A false negative here shows someone `solana-9wz…@wallet.kwami.invalid` as
    // their email and tells them the account is recoverable when it is not.
    expect(isPlaceholderEmail(walletEmail('solana', '9wzdxwbg'))).toBe(true)
    expect(isPlaceholderEmail('alex@example.com')).toBe(false)
    expect(isPlaceholderEmail(null)).toBe(false)
    expect(isPlaceholderEmail(undefined)).toBe(false)
  })
})
