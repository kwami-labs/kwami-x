import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  AuthorityType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { createKwamiIx } from '#shared/solana/instructions'
import type { KwamiRenderer, ResolutionMode } from '#shared/types/kwami'

export interface MintDraft {
  name: string
  tagline: string
  persona: string
  renderer: KwamiRenderer
  secret: string
  hints: string[]
  ticketPriceLamports: bigint
  ticketPriceUsdc: bigint
  sessionDuration: number
  payoutBps: number
  resolutionMode: ResolutionMode
}

export type MintPhase = 'idle' | 'committing' | 'building' | 'signing' | 'confirming' | 'done' | 'error'

/**
 * The mint flow.
 *
 * One transaction does everything: it creates the NFT mint, hands the single
 * token to the creator, permanently revokes the mint authority, and creates the
 * Kwami's on-chain game account and vault. Bundling matters — split across
 * transactions, a failure between them leaves an NFT with no Kwami behind it
 * (or worse, a mint someone else can race to claim), and the user is left
 * holding a broken half-object with real SOL spent on it.
 *
 * Phantom's `signAndSendTransaction` carries the whole bundle, so the user sees
 * one decoded prompt listing exactly what is being created.
 */
export function useMintKwami() {
  const wallet = useWalletStore()
  const config = useRuntimeConfig()

  const phase = ref<MintPhase>('idle')
  const error = ref<string | null>(null)
  const signature = ref<string | null>(null)
  const mintAddress = ref<string | null>(null)

  const busy = computed(() => ['committing', 'building', 'signing', 'confirming'].includes(phase.value))

  async function mint(draft: MintDraft) {
    error.value = null
    signature.value = null
    mintAddress.value = null

    if (!wallet.publicKey) {
      error.value = 'Connect a wallet first.'
      phase.value = 'error'
      return null
    }
    const creator = wallet.publicKey

    try {
      // --- 1. Commit the secret. The server salts and hashes it; the hash is
      // what goes on chain, and it is fixed from this moment on.
      phase.value = 'committing'
      const { draftId, secretHash } = await $fetch<{ draftId: string; secretHash: string }>('/api/kwami/draft', {
        method: 'POST',
        body: {
          ...draft,
          ticketPriceLamports: draft.ticketPriceLamports.toString(),
          ticketPriceUsdc: draft.ticketPriceUsdc.toString(),
          authorWallet: creator.toBase58(),
        },
      })

      // --- 2. Build the bundle.
      phase.value = 'building'
      const connection = wallet.rpc()
      const mintKeypair = Keypair.generate()
      const mint = mintKeypair.publicKey
      const rent = await getMinimumBalanceForRentExemptMint(connection)
      const creatorAta = getAssociatedTokenAddressSync(mint, creator)

      const instructions = [
        SystemProgram.createAccount({
          fromPubkey: creator,
          newAccountPubkey: mint,
          space: MINT_SIZE,
          lamports: rent,
          programId: TOKEN_PROGRAM_ID,
        }),
        // Zero decimals and a supply of one is what makes this a non-fungible
        // token rather than a currency.
        createInitializeMint2Instruction(mint, 0, creator, creator),
        createAssociatedTokenAccountInstruction(creator, creatorAta, creator, mint),
        createMintToInstruction(mint, creatorAta, creator, 1),
        // Revoking the mint authority is what makes the NFT provably unique —
        // without it the author could mint a second copy of the same Kwami at
        // any time and the scarcity claim would be worthless.
        createSetAuthorityInstruction(mint, creator, AuthorityType.MintTokens, null),
        await createKwamiIx({
          mint,
          creator,
          secretHash,
          ticketPriceLamports: draft.ticketPriceLamports,
          ticketPriceUsdc: draft.ticketPriceUsdc,
          sessionDurationSecs: draft.sessionDuration,
          payoutBps: draft.payoutBps,
          resolutionMode: draft.resolutionMode,
          program: new PublicKey(config.public.kwamiProgramId as string),
        }),
      ]

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      const message = new TransactionMessage({
        payerKey: creator,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message()
      const tx = new VersionedTransaction(message)

      // The mint account is a brand-new keypair, so it has to sign for its own
      // creation. Phantom signs for the creator on top of this.
      tx.sign([mintKeypair])

      // --- 3. Sign and send through Phantom.
      phase.value = 'signing'
      const sig = await wallet.signAndSend(tx)
      signature.value = sig
      mintAddress.value = mint.toBase58()

      // --- 4. Wait for confirmation, then bind the draft to the mint.
      phase.value = 'confirming'
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

      await $fetch('/api/kwami/confirm', {
        method: 'POST',
        body: { draftId, mint: mint.toBase58(), signature: sig },
      })

      phase.value = 'done'
      void wallet.refreshBalances()
      return { mint: mint.toBase58(), signature: sig }
    } catch (e) {
      phase.value = 'error'
      error.value = describeWalletError(e)
      return null
    }
  }

  return { phase, busy, error, signature, mintAddress, mint }
}
