/**
 * Instruction builders for the `kwami_vault` program.
 *
 * Each function returns a `TransactionInstruction` ready to drop into a
 * transaction. Account order is load-bearing — it must match the field order of
 * the corresponding `#[derive(Accounts)]` struct in the program exactly, so
 * each builder lists them in the same order as the Rust source and says which
 * struct it mirrors.
 */
import { PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction } from '@solana/web3.js'
import { BorshWriter, concatBytes, instructionDiscriminator } from './borsh'
import { findConfigPda, findExtensionPda, findKwamiPda, findSessionPda, findVaultPda, programId } from './pda'
import type { ResolutionMode } from '../types/kwami'

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

/** Discriminators are eight fixed bytes per instruction; derive each once. */
const discriminatorCache = new Map<string, Uint8Array>()

async function disc(name: string): Promise<Uint8Array> {
  const cached = discriminatorCache.get(name)
  if (cached) return cached
  const value = await instructionDiscriminator(name)
  discriminatorCache.set(name, value)
  return value
}

/** Anchor encodes `ResolutionMode` as its declaration index. */
const RESOLUTION_MODE_INDEX: Record<ResolutionMode, number> = {
  'commit-reveal': 0,
  attested: 1,
}

export function deriveAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0]
}

export interface CreateKwamiArgs {
  mint: PublicKey
  creator: PublicKey
  /** 32-byte SHA-256 commitment, hex. */
  secretHash: string
  ticketPriceLamports: bigint
  ticketPriceUsdc: bigint
  sessionDurationSecs: number
  payoutBps: number
  resolutionMode: ResolutionMode
  program?: PublicKey
}

/** Mirrors `CreateKwami` in `programs/kwami-vault/src/lib.rs`. */
export async function createKwamiIx(args: CreateKwamiArgs): Promise<TransactionInstruction> {
  const program = args.program ?? programId()
  const [kwami] = findKwamiPda(args.mint, program)
  const [vault] = findVaultPda(args.mint, program)

  const data = concatBytes(
    await disc('create_kwami'),
    new BorshWriter()
      .fixed(hexToBytes(args.secretHash, 32))
      .u64(args.ticketPriceLamports)
      .u64(args.ticketPriceUsdc)
      .i64(args.sessionDurationSecs)
      .u16(args.payoutBps)
      .enum(RESOLUTION_MODE_INDEX[args.resolutionMode])
      .toBytes(),
  )

  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: kwami, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.creator, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  })
}

/** Mirrors `OwnerAction`. Used by both `publish` and `pause`. */
export async function ownerActionIx(
  name: 'publish' | 'pause',
  mint: PublicKey,
  owner: PublicKey,
  program = programId(),
): Promise<TransactionInstruction> {
  const [kwami] = findKwamiPda(mint, program)
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: kwami, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(await disc(name)),
  })
}

export interface StartSessionSolArgs {
  mint: PublicKey
  player: PublicKey
  treasury: PublicKey
  author: PublicKey
  nonce: bigint
  program?: PublicKey
}

/** Mirrors `StartSessionSol`. */
export async function startSessionSolIx(args: StartSessionSolArgs): Promise<TransactionInstruction> {
  const program = args.program ?? programId()
  const [config] = findConfigPda(program)
  const [kwami] = findKwamiPda(args.mint, program)
  const [vault] = findVaultPda(args.mint, program)
  const [session] = findSessionPda(args.mint, args.player, args.nonce, program)

  const data = concatBytes(await disc('start_session_sol'), new BorshWriter().u64(args.nonce).toBytes())

  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: kwami, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: session, isSigner: false, isWritable: true },
      { pubkey: args.player, isSigner: true, isWritable: true },
      { pubkey: args.treasury, isSigner: false, isWritable: true },
      { pubkey: args.author, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  })
}

export interface StartSessionUsdcArgs extends StartSessionSolArgs {
  usdcMint: PublicKey
}

/** Mirrors `StartSessionUsdc`. */
export async function startSessionUsdcIx(args: StartSessionUsdcArgs): Promise<TransactionInstruction> {
  const program = args.program ?? programId()
  const [config] = findConfigPda(program)
  const [kwami] = findKwamiPda(args.mint, program)
  const [vault] = findVaultPda(args.mint, program)
  const [session] = findSessionPda(args.mint, args.player, args.nonce, program)

  const data = concatBytes(await disc('start_session_usdc'), new BorshWriter().u64(args.nonce).toBytes())

  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: kwami, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: session, isSigner: false, isWritable: true },
      { pubkey: args.player, isSigner: true, isWritable: true },
      { pubkey: args.usdcMint, isSigner: false, isWritable: false },
      { pubkey: deriveAssociatedTokenAddress(args.usdcMint, args.player), isSigner: false, isWritable: true },
      { pubkey: deriveAssociatedTokenAddress(args.usdcMint, vault), isSigner: false, isWritable: true },
      {
        pubkey: deriveAssociatedTokenAddress(args.usdcMint, args.treasury),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: deriveAssociatedTokenAddress(args.usdcMint, args.author), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  })
}

export interface ClaimWinArgs {
  mint: PublicKey
  player: PublicKey
  nonce: bigint
  /** The secret pre-image, for commit-reveal. */
  preimage?: Uint8Array
  /** Attestation deadline, for attested mode. */
  validUntil?: bigint
  usdcMint?: PublicKey
  program?: PublicKey
}

/**
 * Mirrors `ClaimWin`.
 *
 * The four USDC accounts are `Option<..>` in the program. Anchor encodes an
 * absent optional account as the *program id* in that slot, not as a missing
 * key — omitting the slot entirely would shift every later account by one.
 */
export async function claimWinRevealIx(args: ClaimWinArgs): Promise<TransactionInstruction> {
  if (!args.preimage) throw new Error('claimWinRevealIx requires a pre-image.')
  const program = args.program ?? programId()
  const data = concatBytes(await disc('claim_win_reveal'), new BorshWriter().bytes(args.preimage).toBytes())
  return new TransactionInstruction({
    programId: program,
    keys: claimWinKeys(args, program),
    data: Buffer.from(data),
  })
}

/** Mirrors `ClaimWinAttested`, which wraps `ClaimWin` and adds the sysvar. */
export async function claimWinAttestedIx(args: ClaimWinArgs): Promise<TransactionInstruction> {
  if (args.validUntil === undefined) throw new Error('claimWinAttestedIx requires validUntil.')
  const program = args.program ?? programId()
  const data = concatBytes(await disc('claim_win_attested'), new BorshWriter().i64(args.validUntil).toBytes())
  return new TransactionInstruction({
    programId: program,
    keys: [
      ...claimWinKeys(args, program),
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  })
}

function claimWinKeys(args: ClaimWinArgs, program: PublicKey) {
  const [config] = findConfigPda(program)
  const [kwami] = findKwamiPda(args.mint, program)
  const [vault] = findVaultPda(args.mint, program)
  const [session] = findSessionPda(args.mint, args.player, args.nonce, program)

  const usdc = args.usdcMint
  const none = { pubkey: program, isSigner: false, isWritable: false }

  return [
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: kwami, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: session, isSigner: false, isWritable: true },
    { pubkey: args.player, isSigner: true, isWritable: true },
    usdc ? { pubkey: usdc, isSigner: false, isWritable: false } : none,
    usdc ? { pubkey: deriveAssociatedTokenAddress(usdc, vault), isSigner: false, isWritable: true } : none,
    usdc
      ? { pubkey: deriveAssociatedTokenAddress(usdc, args.player), isSigner: false, isWritable: true }
      : none,
    usdc ? { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false } : none,
    // The vault is a system-owned PDA, so paying a winner is a CPI to the
    // System Program rather than a direct lamport write. Not optional.
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]
}

/** Mirrors `SettleSession`. Permissionless — anyone may close an expired session. */
export async function settleSessionIx(
  mint: PublicKey,
  player: PublicKey,
  nonce: bigint,
  program = programId(),
): Promise<TransactionInstruction> {
  const [kwami] = findKwamiPda(mint, program)
  const [session] = findSessionPda(mint, player, nonce, program)
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: kwami, isSigner: false, isWritable: false },
      { pubkey: session, isSigner: false, isWritable: true },
      { pubkey: player, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(await disc('settle_session')),
  })
}

/** Mirrors `SyncOwner`. Permissionless: it only copies the NFT holder across. */
export async function syncOwnerIx(
  mint: PublicKey,
  nftTokenAccount: PublicKey,
  program = programId(),
): Promise<TransactionInstruction> {
  const [kwami] = findKwamiPda(mint, program)
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: kwami, isSigner: false, isWritable: true },
      { pubkey: nftTokenAccount, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(await disc('sync_owner')),
  })
}

/** Mirrors `RegisterExtension`. */
export async function registerExtensionIx(
  mint: PublicKey,
  owner: PublicKey,
  extensionProgram: PublicKey,
  codeHash: string,
  hooks: number,
  program = programId(),
): Promise<TransactionInstruction> {
  const [kwami] = findKwamiPda(mint, program)
  const [extension] = findExtensionPda(mint, program)
  const data = concatBytes(
    await disc('register_extension'),
    new BorshWriter().fixed(hexToBytes(codeHash, 32)).u8(hooks).toBytes(),
  )
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: kwami, isSigner: false, isWritable: true },
      { pubkey: extension, isSigner: false, isWritable: true },
      { pubkey: extensionProgram, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  })
}

export function hexToBytes(hex: string, expectedLength?: number): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new Error('Hex string has an odd length.')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} bytes, got ${bytes.length}.`)
  }
  return bytes
}
