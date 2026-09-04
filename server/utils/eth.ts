import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { EIP191_PREFIX_BYTE, eip191Preamble } from '#shared/auth/siwe'

/**
 * Ethereum signature recovery for MetaMask sign-in.
 *
 * Hand-rolled on `@noble/curves` rather than pulling in viem or ethers: the
 * only Ethereum operation Kwami performs is recovering an address from a
 * `personal_sign` signature, and a full client library is several hundred
 * kilobytes of transitive dependency for one elliptic-curve call.
 */

/**
 * The EIP-191 digest MetaMask actually signs.
 *
 * `personal_sign` does not sign the message: it signs
 * `keccak256(0x19 || "Ethereum Signed Message:\n" || len || message)`. The
 * prefix is what stops a dapp from tricking a user into signing something that
 * is also a valid transaction.
 *
 * The length is the *byte* length, not the character count, so a message
 * containing anything non-ASCII would recover the wrong address if measured
 * with `String.length`.
 */
export function eip191Digest(message: string): Uint8Array {
  const body = new TextEncoder().encode(message)
  const preamble = new TextEncoder().encode(eip191Preamble(body.length))
  const buf = new Uint8Array(1 + preamble.length + body.length)
  buf[0] = EIP191_PREFIX_BYTE
  buf.set(preamble, 1)
  buf.set(body, 1 + preamble.length)
  return keccak_256(buf)
}

/** Derive the 0x address from an uncompressed public key. */
function addressFromPublicKey(uncompressed: Uint8Array): string {
  // Drop the 0x04 prefix; the address is the last 20 bytes of keccak(x || y).
  const hash = keccak_256(uncompressed.slice(1))
  return `0x${Buffer.from(hash).subarray(-20).toString('hex')}`
}

/**
 * Recover the signer of a `personal_sign` signature.
 *
 * Wallets serialise as `r || s || v` with `v` last; some use 27/28 and some
 * use 0/1, so both are normalised. Returns `null` on anything malformed rather
 * than throwing — a bad signature is an ordinary 401, not a server fault.
 */
export function recoverEthAddress(message: string, signature: string): string | null {
  try {
    const hex = signature.startsWith('0x') ? signature.slice(2) : signature
    if (hex.length !== 130) return null

    const bytes = Buffer.from(hex, 'hex')
    if (bytes.length !== 65) return null
    const compact = new Uint8Array(bytes.subarray(0, 64))
    let recovery = bytes.readUInt8(64)
    if (recovery >= 27) recovery -= 27
    if (recovery !== 0 && recovery !== 1) return null

    const digest = eip191Digest(message)
    const sig = secp256k1.Signature.fromCompact(compact).addRecoveryBit(recovery)
    const publicKey = sig.recoverPublicKey(digest).toRawBytes(false)
    return addressFromPublicKey(publicKey)
  } catch {
    return null
  }
}

/**
 * EIP-55 checksummed form of an address.
 *
 * Worth storing over the lowercase form: a checksummed address catches a
 * typo'd character, and users recognise their own address by its capitalisation.
 */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '')
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString('hex')
  let out = '0x'
  for (let i = 0; i < lower.length; i++) {
    const char = lower[i]!
    out += parseInt(hash[i]!, 16) >= 8 ? char.toUpperCase() : char
  }
  return out
}
