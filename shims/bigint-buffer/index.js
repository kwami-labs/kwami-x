'use strict'

/**
 * Pure-JavaScript replacement for `bigint-buffer`.
 *
 * `@solana/spl-token` depends on `@solana/buffer-layout-utils`, which depends
 * on `bigint-buffer`. That package tries to load a native NAPI addon and falls
 * back to JavaScript when the load fails — except that under Bun the load is a
 * hard panic (`unsupported uv function: uv_version_string`), so the `catch`
 * never runs and the server dies instead of degrading.
 *
 * Bundler-level aliasing does not reliably fix this, because Nitro externalises
 * node_modules and copies the native build through untouched. Overriding the
 * dependency itself does, in every bundler and every runtime.
 *
 * The implementations below are the same algorithms as the upstream JS
 * fallback path. The native addon is a micro-optimisation on buffer/BigInt
 * conversion; nothing in this application converts enough of them to notice.
 *
 * Track: https://github.com/oven-sh/bun/issues/18546
 */

/** Convert a little-endian buffer into a BigInt. */
function toBigIntLE(buf) {
  const reversed = Buffer.from(buf)
  reversed.reverse()
  const hex = reversed.toString('hex')
  if (hex.length === 0) return BigInt(0)
  return BigInt(`0x${hex}`)
}

/** Convert a big-endian buffer into a BigInt. */
function toBigIntBE(buf) {
  const hex = buf.toString('hex')
  if (hex.length === 0) return BigInt(0)
  return BigInt(`0x${hex}`)
}

/** Convert a BigInt to a little-endian buffer of exactly `width` bytes. */
function toBufferLE(num, width) {
  const hex = num.toString(16)
  // `padStart` to twice the width because each byte is two hex characters;
  // a short value must be zero-extended, not truncated.
  const buffer = Buffer.from(hex.padStart(width * 2, '0').slice(0, width * 2), 'hex')
  buffer.reverse()
  return buffer
}

/** Convert a BigInt to a big-endian buffer of exactly `width` bytes. */
function toBufferBE(num, width) {
  const hex = num.toString(16)
  return Buffer.from(hex.padStart(width * 2, '0').slice(0, width * 2), 'hex')
}

exports.toBigIntLE = toBigIntLE
exports.toBigIntBE = toBigIntBE
exports.toBufferLE = toBufferLE
exports.toBufferBE = toBufferBE
