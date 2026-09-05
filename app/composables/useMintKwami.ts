import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { createKwamiIx } from '#shared/solana/instructions'
import { buildMintInstructions } from '~/utils/mint-instructions'
import { SECONDARY_ROYALTY_BPS, commissionToLamports } from '#shared/game/constants'
import type { KwamiRenderer, ResolutionMode } from '#shared/types/kwami'

export interface MintDraft {
  name: string
  tagline: string
  persona: string
  renderer: KwamiRenderer
  /** The palette the creator designed it in — `{ colorA, colorB }`. */
  appearance: Record<string, string>
  /** Voice, game and guard strength, as `shared/kwami/voice` defines them. */
  voice: Record<string, unknown>
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
 *
 * The bundle also writes Metaplex metadata, pointed at a live JSON endpoint
 * rather than a file on IPFS. A Kwami's headline number is its pot, and a
 * document pinned at mint would advertise `$0.00` for the rest of its life.
 *
 * `@solana/spl-token` is imported dynamically rather than at module scope. The
 * mint transaction is built and signed entirely in the browser, so the library
 * has no business in the SSR bundle — and keeping it out matters beyond bundle
 * size: it pulls in `bigint-buffer`, whose native addon hard-panics under Bun
 * (oven-sh/bun#18546) rather than falling back to its own JavaScript path.
 */
export function useMintKwami() {
  const wallet = useWalletStore()
  const config = useRuntimeConfig()
  // `/api/kwami/draft` and `/api/kwami/confirm` both require a signed-in author.
  const api = useApi()

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
      const { draftId, secretHash } = await api<{ draftId: string; secretHash: string }>('/api/kwami/draft', {
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
      // Loaded lazily: spl-token pulls a large graph that a visitor who never mints
      // should not pay for.
      const splToken = await import('@solana/spl-token')
      const { getAssociatedTokenAddressSync, getMinimumBalanceForRentExemptMint } = splToken

      const connection = wallet.rpc()
      const mintKeypair = Keypair.generate()
      const mint = mintKeypair.publicKey
      const rent = await getMinimumBalanceForRentExemptMint(connection)
      const creatorAta = getAssociatedTokenAddressSync(mint, creator)

      const instructions = buildMintInstructions({
        creator,
        mint,
        creatorAta,
        rent,
        name: draft.name,
        metadataUri: `${config.public.siteUrl}/api/kwami/${mint.toBase58()}/metadata`,
        sellerFeeBasisPoints: SECONDARY_ROYALTY_BPS,
        createKwamiIx: await createKwamiIx({
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
        splToken,
      })

      // The platform's flat commission, appended last so a failure anywhere
      // earlier in the bundle costs the creator nothing. It is a plain system
      // transfer rather than a program instruction on purpose: Phantom decodes
      // it and shows "0.5 SOL to <treasury>" as its own line in the preview,
      // where an opaque CPI inside the vault instruction would be invisible.
      const commission = commissionToLamports(config.public.mintCommissionSol as string)
      const treasury = (config.public.platformTreasury as string) || ''
      if (commission > 0n && treasury) {
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: creator,
            toPubkey: new PublicKey(treasury),
            lamports: commission,
          }),
        )
      }

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

      await api('/api/kwami/confirm', {
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
