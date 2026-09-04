#!/usr/bin/env bun
/**
 * Generate the keys Kwami needs and print them as `.env` lines.
 *
 * Two keys, with very different consequences if lost:
 *
 * - `NUXT_SECRET_ENCRYPTION_KEY` decrypts every Kwami secret. Lose it and every
 *   existing Kwami becomes unplayable, because the voice agent can no longer
 *   tell when a challenger has won. There is no recovery path.
 * - `NUXT_ORACLE_SECRET_KEY` signs win attestations. Lose it and attested
 *   Kwamis stop being claimable until a new oracle is set in the protocol
 *   config; commit–reveal Kwamis are unaffected.
 */
import { randomBytes } from 'node:crypto'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

const encryptionKey = randomBytes(32).toString('hex')
const oracle = Keypair.generate()

console.log(`
# ─── Generated ${new Date().toISOString()} ────────────────────────────────
# Append these to .env. Back them up somewhere real — neither is recoverable.

# Encrypts Kwami secrets at rest (AES-256-GCM).
NUXT_SECRET_ENCRYPTION_KEY=${encryptionKey}

# Win-attestation oracle. Its public key goes into the on-chain protocol config.
NUXT_ORACLE_SECRET_KEY=${bs58.encode(oracle.secretKey)}

# Oracle public key (for initialize_config / update_config):
#   ${oracle.publicKey.toBase58()}
`)
