import { describe, expect, it } from 'vitest'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import {
  createMetadataV3Ix,
  findMetadataPda,
  MAX_NAME_LENGTH,
  MAX_SYMBOL_LENGTH,
  MAX_URI_LENGTH,
  TOKEN_METADATA_PROGRAM_ID,
} from '#shared/solana/token-metadata'

const MINT = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')
const CREATOR = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')

function base(overrides: Partial<Parameters<typeof createMetadataV3Ix>[0]> = {}) {
  return createMetadataV3Ix({
    mint: MINT,
    creator: CREATOR,
    name: 'The Vault Keeper',
    symbol: 'KWAMI',
    uri: 'https://x.kwami.io/api/kwami/abc/metadata',
    sellerFeeBasisPoints: 100,
    ...overrides,
  })
}

describe('findMetadataPda', () => {
  it('derives the canonical Metaplex address', () => {
    const [pda] = findMetadataPda(MINT)
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBytes(), MINT.toBytes()],
      TOKEN_METADATA_PROGRAM_ID,
    )
    expect(pda.toBase58()).toBe(expected.toBase58())
  })

  it('is deterministic and mint-specific', () => {
    const other = new PublicKey('So11111111111111111111111111111111111111112')
    expect(findMetadataPda(MINT)[0].toBase58()).toBe(findMetadataPda(MINT)[0].toBase58())
    expect(findMetadataPda(MINT)[0].toBase58()).not.toBe(findMetadataPda(other)[0].toBase58())
  })
})

describe('createMetadataV3Ix', () => {
  it('targets the Token Metadata program with instruction 33', () => {
    const ix = base()
    expect(ix.programId.toBase58()).toBe(TOKEN_METADATA_PROGRAM_ID.toBase58())
    expect(ix.data[0]).toBe(33)
  })

  it('lists accounts in CreateMetadataAccountV3 order', () => {
    const ix = base()
    const [metadata] = findMetadataPda(MINT)
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      metadata.toBase58(),
      MINT.toBase58(),
      CREATOR.toBase58(), // mint authority
      CREATOR.toBase58(), // payer
      CREATOR.toBase58(), // update authority
      SystemProgram.programId.toBase58(),
    ])
  })

  it('requires the mint authority and the payer to sign', () => {
    const ix = base()
    expect(ix.keys[2]!.isSigner).toBe(true)
    expect(ix.keys[3]!.isSigner).toBe(true)
    expect(ix.keys[3]!.isWritable).toBe(true)
    // The update authority slot is recorded, not signed.
    expect(ix.keys[4]!.isSigner).toBe(false)
  })

  it('encodes the DataV2 strings with u32 length prefixes', () => {
    const ix = base({ name: 'AB', symbol: 'CD', uri: 'EF' })
    const d = ix.data
    let o = 1
    expect(d.readUInt32LE(o)).toBe(2)
    expect(d.subarray(o + 4, o + 6).toString()).toBe('AB')
    o += 4 + 2
    expect(d.readUInt32LE(o)).toBe(2)
    expect(d.subarray(o + 4, o + 6).toString()).toBe('CD')
    o += 4 + 2
    expect(d.readUInt32LE(o)).toBe(2)
    expect(d.subarray(o + 4, o + 6).toString()).toBe('EF')
    o += 4 + 2
    expect(d.readUInt16LE(o)).toBe(100) // sellerFeeBasisPoints
  })

  it('always writes isMutable = false', () => {
    // A Kwami's identity is as fixed as its game rules. If this ever flips,
    // an owner could rename or repoint a Kwami after people paid to play it.
    const ix = base({ name: 'A', symbol: 'B', uri: 'C' })
    // …u16 fee, creators Option(1) + len(4) + 34 bytes, collection(0), uses(0), isMutable
    const offset = 1 + (4 + 1) * 3 + 2 + 1 + 4 + 34 + 1 + 1
    expect(ix.data[offset]).toBe(0)
  })

  it('defaults to the creator holding 100% of the royalty, verified', () => {
    const ix = base({ name: 'A', symbol: 'B', uri: 'C' })
    const creatorsAt = 1 + (4 + 1) * 3 + 2
    expect(ix.data[creatorsAt]).toBe(1) // Option::Some
    expect(ix.data.readUInt32LE(creatorsAt + 1)).toBe(1) // one creator
    const entry = creatorsAt + 5
    expect(ix.data.subarray(entry, entry + 32).equals(Buffer.from(CREATOR.toBytes()))).toBe(true)
    expect(ix.data[entry + 32]).toBe(1) // verified
    expect(ix.data[entry + 33]).toBe(100) // share
  })

  it('rejects creator shares that do not total 100', () => {
    // The program rejects this too, but only mid-transaction — after the user
    // has already approved it in their wallet.
    expect(() =>
      base({ creators: [{ address: CREATOR, verified: true, share: 60 }] }),
    ).toThrow(/total 100/)
  })

  it('enforces the on-chain string limits in bytes, not characters', () => {
    expect(() => base({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) })).toThrow(/name is 33 bytes/)
    expect(() => base({ symbol: 'x'.repeat(MAX_SYMBOL_LENGTH + 1) })).toThrow(/symbol/)
    expect(() => base({ uri: `https://x/${'y'.repeat(MAX_URI_LENGTH)}` })).toThrow(/uri/)

    // Eight emoji are eight characters but 32 bytes — right at the limit.
    expect(() => base({ name: '🌙'.repeat(8) })).not.toThrow()
    expect(() => base({ name: '🌙'.repeat(9) })).toThrow(/36 bytes/)
  })

  it('rejects an out-of-range royalty', () => {
    expect(() => base({ sellerFeeBasisPoints: 10_001 })).toThrow(RangeError)
    expect(() => base({ sellerFeeBasisPoints: -1 })).toThrow(RangeError)
  })
})
