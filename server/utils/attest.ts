import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { PublicKey } from '@solana/web3.js'
import { oracleKeypair } from './solana'

/** Matches `WinAttestation::message` in `programs/kwami-vault/src/attestation.rs`. */
const DOMAIN_TAG = new TextEncoder().encode('KWAMIWIN')

/** How long a signed win stays claimable. Long enough to sign, short enough not to sit around. */
const ATTESTATION_TTL_SECS = 300

export interface SignedAttestation {
  /** base58 ed25519 signature over the attestation message. */
  signature: string
  /** base58 oracle public key, so the client can build the Ed25519Program instruction. */
  oracle: string
  /** Unix seconds after which the program refuses this attestation. */
  validUntil: number
  /** The exact bytes signed, base64, so the client does not have to rebuild them. */
  message: string
}

/**
 * Sign a win certificate for `Attested` mode.
 *
 * The message binds the session account, the player and a deadline. Without
 * all three, a captured signature could be replayed against another session,
 * by another wallet, or indefinitely.
 *
 * The oracle key can only witness — the program gives it no authority to move
 * funds — so a compromise means forged wins on attested Kwamis, not a drained
 * treasury. That asymmetry is why the mode exists at all.
 */
export async function signWinAttestation(sessionAccount: string, playerWallet: string): Promise<SignedAttestation> {
  const keypair = oracleKeypair()
  const validUntil = Math.floor(Date.now() / 1000) + ATTESTATION_TTL_SECS

  const message = new Uint8Array(8 + 32 + 32 + 8)
  message.set(DOMAIN_TAG, 0)
  message.set(new PublicKey(sessionAccount).toBytes(), 8)
  message.set(new PublicKey(playerWallet).toBytes(), 40)
  new DataView(message.buffer).setBigInt64(72, BigInt(validUntil), true)

  const signature = nacl.sign.detached(message, keypair.secretKey)

  return {
    signature: bs58.encode(signature),
    oracle: keypair.publicKey.toBase58(),
    validUntil,
    message: Buffer.from(message).toString('base64'),
  }
}
