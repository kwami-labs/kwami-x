import { describe, expect, it } from 'vitest'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { eip191Digest, recoverEthAddress, toChecksumAddress } from '~~/server/utils/eth'

/** Sign a message the way MetaMask's `personal_sign` does: r || s || v, v last. */
function personalSign(message: string, privateKey: Uint8Array): string {
  const digest = eip191Digest(message)
  const sig = secp256k1.sign(digest, privateKey, { prehash: false })
  const compact = sig.toCompactRawBytes()
  return `0x${Buffer.from(compact).toString('hex')}${(sig.recovery! + 27).toString(16).padStart(2, '0')}`
}

function addressOf(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, false)
  return `0x${Buffer.from(keccak_256(pub.slice(1)))
    .subarray(-20)
    .toString('hex')}`
}

describe('recoverEthAddress', () => {
  const key = secp256k1.utils.randomPrivateKey()
  const address = addressOf(key)

  it('recovers the signer of a personal_sign signature', () => {
    const message = 'x.kwami.io wants you to sign in with your Ethereum account:'
    expect(recoverEthAddress(message, personalSign(message, key))).toBe(address)
  })

  it('recovers correctly for a message containing non-ASCII', () => {
    // The EIP-191 prefix uses the BYTE length. Measuring with String.length
    // would recover a different, wrong address here.
    const message = 'Sign in — café 🌙'
    expect(recoverEthAddress(message, personalSign(message, key))).toBe(address)
  })

  it('recovers a different address for a different message', () => {
    const signature = personalSign('one', key)
    expect(recoverEthAddress('two', signature)).not.toBe(address)
  })

  it('accepts a legacy v of 0 or 1 as well as 27 or 28', () => {
    const message = 'hello'
    const signature = personalSign(message, key)
    const legacy =
      signature.slice(0, -2) + (parseInt(signature.slice(-2), 16) - 27).toString(16).padStart(2, '0')
    expect(recoverEthAddress(message, legacy)).toBe(address)
  })

  it('returns null on malformed input instead of throwing', () => {
    expect(recoverEthAddress('hello', '0x00')).toBeNull()
    expect(recoverEthAddress('hello', 'not hex at all')).toBeNull()
    expect(recoverEthAddress('hello', `0x${'0'.repeat(130)}`)).toBeNull()
  })

  it('returns null for an out-of-range recovery byte', () => {
    const signature = personalSign('hello', key)
    expect(recoverEthAddress('hello', `${signature.slice(0, -2)}ff`)).toBeNull()
  })
})

describe('toChecksumAddress', () => {
  it('produces the EIP-55 form', () => {
    expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    )
  })

  it('is idempotent', () => {
    const checksummed = toChecksumAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359')
    expect(toChecksumAddress(checksummed)).toBe(checksummed)
  })
})
