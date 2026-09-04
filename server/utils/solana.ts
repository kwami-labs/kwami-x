import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'

/**
 * Server-side Solana access.
 *
 * Reads go through a private RPC when one is configured — the public endpoints
 * rate limit hard, and a leaderboard page that fans out to a dozen account
 * reads will trip them within minutes of launch.
 */

let cachedConnection: Connection | null = null

export function connection(): Connection {
  if (cachedConnection) return cachedConnection
  const config = useRuntimeConfig()
  const url = config.solanaRpcUrl || (config.public.solanaRpcUrl as string)
  cachedConnection = new Connection(url, 'confirmed')
  return cachedConnection
}

/**
 * The win-attestation oracle keypair.
 *
 * Only ever used to sign `WinAttestation` messages. It has no authority to move
 * funds — the program treats it strictly as a witness — so the blast radius of
 * a compromise is forged wins on Attested Kwamis, not a drained treasury.
 */
export function oracleKeypair(): Keypair {
  const config = useRuntimeConfig()
  if (!config.oracleSecretKey) {
    throw createError({ statusCode: 500, statusMessage: 'Oracle key is not configured.' })
  }
  return Keypair.fromSecretKey(bs58.decode(config.oracleSecretKey))
}

/** Verify an ed25519 signature over a UTF-8 message by a base58 Solana address. */
export function verifySolanaSignature(message: string, signature: Uint8Array, address: string): boolean {
  try {
    const publicKey = new PublicKey(address)
    return nacl.sign.detached.verify(new TextEncoder().encode(message), signature, publicKey.toBytes())
  } catch {
    return false
  }
}

/** Reject anything that is not a well-formed base58 Solana address. */
export function isValidAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    // `PublicKey` accepts 32-byte values; `isOnCurve` is deliberately *not*
    // required, because PDAs are legitimate addresses here.
    new PublicKey(value)
    return true
  } catch {
    return false
  }
}

/** Convert a lamport balance and a USDC balance into whole US cents. */
export function toCents(lamports: bigint, usdcBaseUnits: bigint, solUsd: number): number {
  const sol = Number(lamports) / 1_000_000_000
  const usdc = Number(usdcBaseUnits) / 1_000_000
  return Math.round((sol * solUsd + usdc) * 100)
}
