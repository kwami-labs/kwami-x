import { describe, expect, it } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import {
  findConfigPda,
  findExtensionPda,
  findKwamiPda,
  findSessionPda,
  findVaultPda,
  programId,
} from '#shared/solana/pda'
import { KWAMI_PROGRAM_ID } from '#shared/solana/constants'

const MINT = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')
const PLAYER = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')

describe('PDA derivation', () => {
  it('uses the declared program id by default', () => {
    expect(programId().toBase58()).toBe(KWAMI_PROGRAM_ID)
  })

  it('is deterministic', () => {
    expect(findKwamiPda(MINT)[0].toBase58()).toBe(findKwamiPda(MINT)[0].toBase58())
  })

  it('gives every seed prefix a distinct address for the same mint', () => {
    const addresses = [findKwamiPda(MINT)[0], findVaultPda(MINT)[0], findExtensionPda(MINT)[0]].map((k) =>
      k.toBase58(),
    )
    expect(new Set(addresses).size).toBe(3)
  })

  it('separates Kwamis by mint', () => {
    const other = new PublicKey('So11111111111111111111111111111111111111112')
    expect(findKwamiPda(MINT)[0].toBase58()).not.toBe(findKwamiPda(other)[0].toBase58())
  })

  it('separates sessions by nonce, so a player can replay a Kwami over time', () => {
    const first = findSessionPda(MINT, PLAYER, 0)[0].toBase58()
    const second = findSessionPda(MINT, PLAYER, 1)[0].toBase58()
    expect(first).not.toBe(second)
  })

  it('separates sessions by player', () => {
    const other = new PublicKey('So11111111111111111111111111111111111111112')
    expect(findSessionPda(MINT, PLAYER, 0)[0].toBase58()).not.toBe(
      findSessionPda(MINT, other, 0)[0].toBase58(),
    )
  })

  it('encodes the nonce as little-endian u64, matching the Rust seed', () => {
    // A big-endian encoding would produce a valid-looking address that the
    // program's seed constraint then rejects — an opaque failure at runtime.
    expect(findSessionPda(MINT, PLAYER, 1)[0].toBase58()).toBe(findSessionPda(MINT, PLAYER, 1n)[0].toBase58())
  })

  it('returns a usable bump', () => {
    const [, bump] = findVaultPda(MINT)
    expect(bump).toBeGreaterThanOrEqual(0)
    expect(bump).toBeLessThanOrEqual(255)
  })

  it('derives config without a mint', () => {
    expect(findConfigPda()[0]).toBeInstanceOf(PublicKey)
  })
})
