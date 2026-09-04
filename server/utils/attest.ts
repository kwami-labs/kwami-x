import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { PublicKey } from '@solana/web3.js'
import { oracleKeypair } from './solana'

/** Matches `WinAttestation::message` in `programs/kwami-vault/src/attestation.rs`. */
const DOMAIN_TAG = 'KWAMIWIN'

/** Byte layout: tag(8) ‖ session(32) ‖ player(32) ‖ valid_until(i64 LE). */
const MESSAGE_LEN = 8 + 32 + 32 + 8

/** How long a signed win stays claimable. Long enough to sign, short enough not to sit around. */
export const ATTESTATION_TTL_SECS = 300

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
 * Build the exact bytes the oracle signs.
 *
 * Kept separate from signing so the layout can be tested without a key. It has
 * to agree with the Rust byte for byte — a disagreement produces a signature
 * the program rejects, with no useful error to explain why.
 *
 * The message binds three things: the session, the player and a deadline. Drop
 * any one and a captured attestation becomes replayable against another
 * session, by another wallet, or forever.
 */
export function attestationMessage(sessionAccount: string, playerWallet: string, validUntil: number): Uint8Array {
  const message = new Uint8Array(MESSAGE_LEN)
  message.set(new TextEncoder().encode(DOMAIN_TAG), 0)
  message.set(new PublicKey(sessionAccount).toBytes(), 8)
  message.set(new PublicKey(playerWallet).toBytes(), 40)
  new DataView(message.buffer).setBigInt64(72, BigInt(validUntil), true)
  return message
}

/**
 * Sign a win certificate for `Attested` mode.
 *
 * The oracle key can only witness — the program gives it no authority to move
 * funds — so a compromise means forged wins on attested Kwamis, not a drained
 * treasury. That asymmetry is why the mode exists at all.
 */
export async function signWinAttestation(
  sessionAccount: string,
  playerWallet: string,
  nowSecs = Math.floor(Date.now() / 1000),
): Promise<SignedAttestation> {
  const keypair = oracleKeypair()
  const validUntil = nowSecs + ATTESTATION_TTL_SECS
  const message = attestationMessage(sessionAccount, playerWallet, validUntil)

  return {
    signature: bs58.encode(nacl.sign.detached(message, keypair.secretKey)),
    oracle: keypair.publicKey.toBase58(),
    validUntil,
    message: Buffer.from(message).toString('base64'),
  }
}
