/**
 * Program-derived address helpers.
 *
 * Every seed layout here is mirrored by a `#[account(seeds = ...)]` constraint
 * in `programs/kwami-vault/src/lib.rs`. If you change one, change both — a
 * mismatch shows up as an opaque `ConstraintSeeds` error at runtime rather
 * than a compile failure.
 */
import { PublicKey } from '@solana/web3.js'
import { KWAMI_PROGRAM_ID, SEEDS } from './constants'

const enc = new TextEncoder()

export function programId(id: string = KWAMI_PROGRAM_ID): PublicKey {
  return new PublicKey(id)
}

/** Global protocol config: fee basis points, treasury, oracle authority. */
export function findConfigPda(program = programId()): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc.encode(SEEDS.config)], program)
}

/** The Kwami account: one per NFT mint, holds the secret hash and game rules. */
export function findKwamiPda(mint: PublicKey, program = programId()): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc.encode(SEEDS.kwami), mint.toBytes()], program)
}

/** The vault: a system-owned PDA holding SOL, and the authority over the USDC ATA. */
export function findVaultPda(mint: PublicKey, program = programId()): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc.encode(SEEDS.vault), mint.toBytes()], program)
}

/**
 * A challenge session.
 *
 * Seeded by `(mint, player, nonce)` so one player can hold several sessions
 * against the same Kwami over time without address collisions, while still
 * being unable to open two concurrently — `start_session` rejects a nonce that
 * is not the Kwami's current session counter for that player.
 */
export function findSessionPda(
  mint: PublicKey,
  player: PublicKey,
  nonce: number | bigint,
  program = programId(),
): [PublicKey, number] {
  const nonceBuf = new Uint8Array(8)
  new DataView(nonceBuf.buffer).setBigUint64(0, BigInt(nonce), true)
  return PublicKey.findProgramAddressSync(
    [enc.encode(SEEDS.session), mint.toBytes(), player.toBytes(), nonceBuf],
    program,
  )
}

/** Registration record for an AI-generated sub-program attached to a Kwami. */
export function findExtensionPda(mint: PublicKey, program = programId()): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc.encode(SEEDS.extension), mint.toBytes()], program)
}
