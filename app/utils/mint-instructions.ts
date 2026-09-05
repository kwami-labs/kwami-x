import { SystemProgram } from '@solana/web3.js'
import type { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { createMetadataV3Ix, MAX_NAME_LENGTH } from '#shared/solana/token-metadata'

export interface MintBundleInput {
  /** The wallet minting, paying, and receiving the NFT. */
  creator: PublicKey
  /** The freshly generated mint keypair's public key. */
  mint: PublicKey
  /** The creator's associated token account for `mint`. */
  creatorAta: PublicKey
  /** Rent for a mint account, in lamports. */
  rent: number
  name: string
  /** Where the NFT's live metadata is served from. */
  metadataUri: string
  sellerFeeBasisPoints: number
  /** The vault's `create_kwami`, built by the caller (it is async and needs the program id). */
  createKwamiIx: TransactionInstruction
  /** `@solana/spl-token`, injected so this stays testable and tree-shakeable. */
  splToken: typeof import('@solana/spl-token')
}

/**
 * The instruction bundle that mints one Kwami.
 *
 * Extracted from `useMintKwami` because the order and the authority arguments here decide
 * properties of the NFT that can never be changed afterwards, and none of it had a test. Three
 * separate defects lived in this sequence, two of which would have been permanent for anything
 * already minted.
 *
 * Order is load-bearing:
 *
 * 1. Create and initialise the mint — zero decimals, supply of one, and **no freeze authority**.
 * 2. Create the creator's token account and mint the single token into it.
 * 3. Write the Metaplex metadata, which must happen while the creator still holds mint
 *    authority.
 * 4. Revoke mint authority, so a second copy can never be minted.
 * 5. Create the vault's on-chain Kwami account.
 */
export function buildMintInstructions(input: MintBundleInput): TransactionInstruction[] {
  const {
    createAssociatedTokenAccountInstruction,
    createInitializeMint2Instruction,
    createMintToInstruction,
    createSetAuthorityInstruction,
    AuthorityType,
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
  } = input.splToken

  return [
    SystemProgram.createAccount({
      fromPubkey: input.creator,
      newAccountPubkey: input.mint,
      space: MINT_SIZE,
      lamports: input.rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    // Zero decimals and a supply of one is what makes this a non-fungible token rather than a
    // currency. The fourth argument is the FREEZE authority: it must be null. Passing the
    // creator there left the minter able to freeze any future holder's token account,
    // permanently and unrevokably — a Kwami someone bought could be made untradeable, and its
    // pot untouchable, by the person who made it.
    createInitializeMint2Instruction(input.mint, 0, input.creator, null),
    createAssociatedTokenAccountInstruction(input.creator, input.creatorAta, input.creator, input.mint),
    createMintToInstruction(input.mint, input.creatorAta, input.creator, 1),
    // Metadata must be created while `creator` still holds mint authority, which the next
    // instruction revokes. Without this the token is a number in a ledger: "Unknown Token" in
    // Phantom, and unlistable on every marketplace.
    createMetadataV3Ix({
      mint: input.mint,
      creator: input.creator,
      name: input.name.slice(0, MAX_NAME_LENGTH),
      symbol: 'KWAMI',
      uri: input.metadataUri,
      sellerFeeBasisPoints: input.sellerFeeBasisPoints,
    }),
    // Revoking the mint authority is what makes the NFT provably unique — without it the author
    // could mint a second copy of the same Kwami at any time and the scarcity claim would be
    // worthless.
    createSetAuthorityInstruction(input.mint, input.creator, AuthorityType.MintTokens, null),
    input.createKwamiIx,
  ]
}
