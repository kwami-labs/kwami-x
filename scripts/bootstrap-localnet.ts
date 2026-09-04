#!/usr/bin/env bun
/**
 * Bring a local validator to a state where the app is actually playable.
 *
 * Creates the protocol config account, a USDC-like mint with six decimals, and
 * a funded treasury. Run once after `anchor deploy` against a fresh
 * `solana-test-validator`.
 *
 * Idempotent: re-running skips anything that already exists, so it is safe to
 * run again after a partial failure.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import type { TransactionInstruction } from '@solana/web3.js'
import {
  createInitializeMint2Instruction,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BorshWriter, concatBytes, instructionDiscriminator } from '../shared/solana/borsh'
import { findConfigPda } from '../shared/solana/pda'
import { KWAMI_PROGRAM_ID, PROTOCOL_RPC } from './_config'

const RPC = process.env.NUXT_PUBLIC_SOLANA_RPC_URL ?? PROTOCOL_RPC
const PROGRAM = new PublicKey(process.env.NUXT_PUBLIC_KWAMI_PROGRAM_ID ?? KWAMI_PROGRAM_ID)
const FEE_BPS = 250

function loadWallet(): Keypair {
  const path = process.env.SOLANA_WALLET ?? join(homedir(), '.config', 'solana', 'id.json')
  if (!existsSync(path)) {
    throw new Error(`No wallet at ${path}. Run \`solana-keygen new\` or set SOLANA_WALLET.`)
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

async function send(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  extraSigners: Keypair[] = [],
) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const tx = new VersionedTransaction(
    new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message(),
  )
  tx.sign([payer, ...extraSigners])
  const signature = await connection.sendTransaction(tx)
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}

const connection = new Connection(RPC, 'confirmed')
const payer = loadWallet()

console.log(`RPC      ${RPC}`)
console.log(`Program  ${PROGRAM.toBase58()}`)
console.log(`Payer    ${payer.publicKey.toBase58()}`)

// --- Fund the payer if the validator has not already.
const balance = await connection.getBalance(payer.publicKey)
if (balance < 2 * LAMPORTS_PER_SOL) {
  console.log('Airdropping 5 SOL…')
  const sig = await connection.requestAirdrop(payer.publicKey, 5 * LAMPORTS_PER_SOL)
  await connection.confirmTransaction(sig, 'confirmed')
}

// --- USDC-like mint.
const usdcMint = Keypair.generate()
const rent = await getMinimumBalanceForRentExemptMint(connection)
await send(
  connection,
  payer,
  [
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: usdcMint.publicKey,
      space: MINT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(usdcMint.publicKey, 6, payer.publicKey, null),
  ],
  [usdcMint],
)
console.log(`USDC     ${usdcMint.publicKey.toBase58()}`)

// --- Protocol config.
const [configPda] = findConfigPda(PROGRAM)
if (await connection.getAccountInfo(configPda)) {
  console.log(`Config   ${configPda.toBase58()} (already exists)`)
} else {
  const oracle = Keypair.generate()
  const data = concatBytes(
    await instructionDiscriminator('initialize_config'),
    new BorshWriter().u16(FEE_BPS).fixed(oracle.publicKey.toBytes()).toBytes(),
  )
  await send(connection, payer, [
    {
      programId: PROGRAM,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: payer.publicKey, isSigner: false, isWritable: false }, // treasury
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    },
  ])
  console.log(`Config   ${configPda.toBase58()}`)
  console.log(`Oracle   ${oracle.publicKey.toBase58()}`)
  console.log(`\nAdd to .env:`)
  console.log(`NUXT_PUBLIC_USDC_MINT=${usdcMint.publicKey.toBase58()}`)
  console.log(`NUXT_ORACLE_SECRET_KEY=<base58 of the oracle secret key — regenerate with scripts/gen-keys.ts>`)
}

console.log('\nDone.')
