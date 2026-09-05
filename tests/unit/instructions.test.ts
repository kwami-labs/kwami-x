import { describe, expect, it } from 'vitest'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import {
  claimWinAttestedIx,
  claimWinRevealIx,
  createKwamiIx,
  deriveAssociatedTokenAddress,
  hexToBytes,
  ownerActionIx,
  registerExtensionIx,
  settleSessionIx,
  startSessionSolIx,
  startSessionUsdcIx,
  syncOwnerIx,
  TOKEN_PROGRAM_ID,
} from '#shared/solana/instructions'
import { findKwamiPda, findSessionPda, findVaultPda, findConfigPda } from '#shared/solana/pda'
import { instructionDiscriminator } from '#shared/solana/borsh'

const MINT = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')
const CREATOR = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')
const TREASURY = new PublicKey('So11111111111111111111111111111111111111112')
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const HASH = 'a'.repeat(64)

async function expectDiscriminator(data: Buffer, name: string) {
  const expected = await instructionDiscriminator(name)
  expect(Array.from(data.subarray(0, 8))).toEqual(Array.from(expected))
}

describe('createKwamiIx', () => {
  it('leads with the create_kwami discriminator', async () => {
    const ix = await createKwamiIx({
      mint: MINT,
      creator: CREATOR,
      secretHash: HASH,
      ticketPriceLamports: 50_000_000n,
      ticketPriceUsdc: 0n,
      sessionDurationSecs: 180,
      payoutBps: 8000,
      resolutionMode: 'commit-reveal',
    })
    await expectDiscriminator(ix.data, 'create_kwami')
  })

  it('encodes args in the order the Rust struct declares them', async () => {
    const ix = await createKwamiIx({
      mint: MINT,
      creator: CREATOR,
      secretHash: HASH,
      ticketPriceLamports: 1n,
      ticketPriceUsdc: 2n,
      sessionDurationSecs: 180,
      payoutBps: 8000,
      resolutionMode: 'attested',
    })
    // 8 discriminator + 32 hash + 8 + 8 + 8 + 2 + 1
    expect(ix.data.length).toBe(67)
    const body = ix.data.subarray(8)
    expect(Array.from(body.subarray(0, 32))).toEqual(Array.from(hexToBytes(HASH, 32)))
    expect(body.readBigUInt64LE(32)).toBe(1n)
    expect(body.readBigUInt64LE(40)).toBe(2n)
    expect(body.readBigInt64LE(48)).toBe(180n)
    expect(body.readUInt16LE(56)).toBe(8000)
    expect(body[58]).toBe(1) // ResolutionMode::Attested
  })

  it('lists accounts in CreateKwami order', async () => {
    const ix = await createKwamiIx({
      mint: MINT,
      creator: CREATOR,
      secretHash: HASH,
      ticketPriceLamports: 1n,
      ticketPriceUsdc: 0n,
      sessionDurationSecs: 180,
      payoutBps: 8000,
      resolutionMode: 'commit-reveal',
    })
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      findKwamiPda(MINT)[0].toBase58(),
      findVaultPda(MINT)[0].toBase58(),
      MINT.toBase58(),
      CREATOR.toBase58(),
      SystemProgram.programId.toBase58(),
    ])
  })

  it('marks only the creator as a signer', async () => {
    const ix = await createKwamiIx({
      mint: MINT,
      creator: CREATOR,
      secretHash: HASH,
      ticketPriceLamports: 1n,
      ticketPriceUsdc: 0n,
      sessionDurationSecs: 180,
      payoutBps: 8000,
      resolutionMode: 'commit-reveal',
    })
    expect(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())).toEqual([CREATOR.toBase58()])
  })

  it('rejects a malformed secret hash rather than truncating it', async () => {
    await expect(
      createKwamiIx({
        mint: MINT,
        creator: CREATOR,
        secretHash: 'abcd',
        ticketPriceLamports: 1n,
        ticketPriceUsdc: 0n,
        sessionDurationSecs: 180,
        payoutBps: 8000,
        resolutionMode: 'commit-reveal',
      }),
    ).rejects.toThrow(/32 bytes/)
  })
})

describe('ownerActionIx', () => {
  it('carries no arguments beyond the discriminator', async () => {
    const ix = await ownerActionIx('publish', MINT, CREATOR)
    expect(ix.data.length).toBe(8)
    await expectDiscriminator(ix.data, 'publish')
  })

  it('distinguishes publish from pause', async () => {
    const publish = await ownerActionIx('publish', MINT, CREATOR)
    const pause = await ownerActionIx('pause', MINT, CREATOR)
    expect(publish.data.equals(pause.data)).toBe(false)
  })
})

describe('startSessionSolIx', () => {
  it('lists accounts in StartSessionSol order', async () => {
    const ix = await startSessionSolIx({
      mint: MINT,
      player: CREATOR,
      treasury: TREASURY,
      author: TREASURY,
      nonce: 0n,
    })
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      findConfigPda()[0].toBase58(),
      findKwamiPda(MINT)[0].toBase58(),
      findVaultPda(MINT)[0].toBase58(),
      findSessionPda(MINT, CREATOR, 0n)[0].toBase58(),
      CREATOR.toBase58(),
      TREASURY.toBase58(),
      TREASURY.toBase58(),
      SystemProgram.programId.toBase58(),
    ])
  })

  it('makes the vault, treasury and author writable so lamports can land', async () => {
    const ix = await startSessionSolIx({
      mint: MINT,
      player: CREATOR,
      treasury: TREASURY,
      author: TREASURY,
      nonce: 0n,
    })
    const vault = ix.keys.find((k) => k.pubkey.equals(findVaultPda(MINT)[0]))
    expect(vault?.isWritable).toBe(true)
    expect(ix.keys[5].isWritable).toBe(true)
    expect(ix.keys[6].isWritable).toBe(true)
  })

  it('encodes the nonce as a u64 argument', async () => {
    const ix = await startSessionSolIx({
      mint: MINT,
      player: CREATOR,
      treasury: TREASURY,
      author: TREASURY,
      nonce: 7n,
    })
    expect(ix.data.length).toBe(16)
    expect(ix.data.readBigUInt64LE(8)).toBe(7n)
  })
})

describe('startSessionUsdcIx', () => {
  it('derives every associated token account it needs', async () => {
    const ix = await startSessionUsdcIx({
      mint: MINT,
      player: CREATOR,
      treasury: TREASURY,
      author: TREASURY,
      nonce: 0n,
      usdcMint: USDC,
    })
    const keys = ix.keys.map((k) => k.pubkey.toBase58())
    expect(keys).toContain(deriveAssociatedTokenAddress(USDC, CREATOR).toBase58())
    expect(keys).toContain(deriveAssociatedTokenAddress(USDC, findVaultPda(MINT)[0]).toBase58())
    expect(keys).toContain(TOKEN_PROGRAM_ID.toBase58())
  })
})

describe('claimWinRevealIx', () => {
  it('encodes the pre-image as a length-prefixed Vec<u8>', async () => {
    const preimage = new TextEncoder().encode('the moon remembers')
    const ix = await claimWinRevealIx({ mint: MINT, player: CREATOR, nonce: 0n, preimage })
    expect(ix.data.readUInt32LE(8)).toBe(preimage.length)
    expect(ix.data.length).toBe(8 + 4 + preimage.length)
  })

  it('refuses to build without a pre-image', async () => {
    await expect(claimWinRevealIx({ mint: MINT, player: CREATOR, nonce: 0n })).rejects.toThrow(/pre-image/)
  })

  it('fills absent optional token accounts with the program id, keeping positions stable', async () => {
    // Anchor encodes a missing Option<Account> as the program id in that slot.
    // Omitting the slot would shift every later account by one.
    const ix = await claimWinRevealIx({
      mint: MINT,
      player: CREATOR,
      nonce: 0n,
      preimage: new Uint8Array([1]),
    })
    expect(ix.keys.length).toBe(10)
    for (const key of ix.keys.slice(5, 9)) {
      expect(key.pubkey.equals(ix.programId)).toBe(true)
    }
  })

  it('always passes the System Program, since the vault payout is a CPI', async () => {
    // The vault is system-owned, so the program cannot debit it directly.
    // Omitting this account makes every win fail at settlement.
    const ix = await claimWinRevealIx({
      mint: MINT,
      player: CREATOR,
      nonce: 0n,
      preimage: new Uint8Array([1]),
    })
    expect(ix.keys[9]!.pubkey.toBase58()).toBe(SystemProgram.programId.toBase58())
  })

  it('uses real token accounts when a USDC mint is supplied', async () => {
    const ix = await claimWinRevealIx({
      mint: MINT,
      player: CREATOR,
      nonce: 0n,
      preimage: new Uint8Array([1]),
      usdcMint: USDC,
    })
    expect(ix.keys[5]!.pubkey.toBase58()).toBe(USDC.toBase58())
    expect(ix.keys[8]!.pubkey.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58())
    expect(ix.keys[9]!.pubkey.toBase58()).toBe(SystemProgram.programId.toBase58())
  })
})

describe('claimWinAttestedIx', () => {
  it('appends the instructions sysvar, which the program reads the signature back from', async () => {
    const ix = await claimWinAttestedIx({
      mint: MINT,
      player: CREATOR,
      nonce: 0n,
      validUntil: 1_800_000_000n,
    })
    expect(ix.keys.length).toBe(11)
    expect(ix.keys[10]!.pubkey.toBase58()).toBe('Sysvar1nstructions1111111111111111111111111')
  })

  it('refuses to build without a deadline', async () => {
    await expect(claimWinAttestedIx({ mint: MINT, player: CREATOR, nonce: 0n })).rejects.toThrow(/validUntil/)
  })
})

describe('settleSessionIx and syncOwnerIx', () => {
  it('settle requires no signer, so a keeper can reclaim rent', async () => {
    const ix = await settleSessionIx(MINT, CREATOR, 0n)
    expect(ix.keys.some((k) => k.isSigner)).toBe(false)
  })

  it('sync_owner requires no signer, so a buyer is never locked out by a seller', async () => {
    const ix = await syncOwnerIx(MINT, deriveAssociatedTokenAddress(MINT, CREATOR))
    expect(ix.keys.some((k) => k.isSigner)).toBe(false)
  })
})

describe('registerExtensionIx', () => {
  it('encodes the code hash and hook bitmask', async () => {
    const ix = await registerExtensionIx(MINT, CREATOR, TREASURY, HASH, 0b0101)
    expect(ix.data.length).toBe(8 + 32 + 1)
    expect(ix.data[ix.data.length - 1]).toBe(0b0101)
  })
})

describe('hexToBytes', () => {
  it('accepts a 0x prefix', () => {
    expect(Array.from(hexToBytes('0xff00'))).toEqual([255, 0])
  })

  it('rejects an odd-length string', () => {
    expect(() => hexToBytes('abc')).toThrow(/odd length/)
  })

  it('rejects the wrong length when one is required', () => {
    expect(() => hexToBytes('ffff', 32)).toThrow(/32 bytes/)
  })
})
