/**
 * Metaplex Token Metadata — just enough of it to mint a Kwami.
 *
 * Without a metadata account an SPL token is a number in a ledger: Phantom
 * shows it as "Unknown Token", and Magic Eden and Tensor cannot list it at
 * all. That would quietly break two of the things a Kwami is supposed to be —
 * tradable, and viewable as a 3D object in someone else's app.
 *
 * Hand-encoded rather than pulling in `@metaplex-foundation/mpl-token-metadata`,
 * which arrives with the whole Umi framework — a client abstraction, a signer
 * abstraction and an RPC abstraction — for one instruction whose layout has
 * been stable for years. This mirrors how the Kwami program's own instructions
 * are built a few files over, so there is one encoding style to learn.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js'
import { BorshWriter, concatBytes } from './borsh'

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

/** `CreateMetadataAccountV3` is instruction 33 in the program's enum. */
const CREATE_METADATA_V3 = 33

/** On-chain string fields are fixed-capacity; longer values are rejected outright. */
export const MAX_NAME_LENGTH = 32
export const MAX_SYMBOL_LENGTH = 10
export const MAX_URI_LENGTH = 200

export function findMetadataPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('metadata'), TOKEN_METADATA_PROGRAM_ID.toBytes(), mint.toBytes()],
    TOKEN_METADATA_PROGRAM_ID,
  )
}

export interface Creator {
  address: PublicKey
  verified: boolean
  /** Percentage of the royalty, 0–100. Shares across all creators must total 100. */
  share: number
}

export interface CreateMetadataArgs {
  mint: PublicKey
  /** Also the payer and the update authority. Must still hold mint authority. */
  creator: PublicKey
  name: string
  symbol: string
  /** Points at `/api/kwami/<mint>/metadata.json`. */
  uri: string
  /** Secondary-sale royalty in basis points. */
  sellerFeeBasisPoints: number
  creators?: Creator[]
}

/**
 * Build `CreateMetadataAccountV3`.
 *
 * `isMutable` is hard-coded to `false`. A Kwami's identity is supposed to be
 * as fixed as its game rules, and leaving it mutable would let an owner rename
 * a Kwami — or repoint its image — after people had already paid to play it.
 * Making that a parameter would invite someone to pass `true` for convenience.
 *
 * This must be placed in the mint transaction *before* the mint authority is
 * revoked, since the program requires that authority to sign.
 */
export function createMetadataV3Ix(args: CreateMetadataArgs): TransactionInstruction {
  assertLength('name', args.name, MAX_NAME_LENGTH)
  assertLength('symbol', args.symbol, MAX_SYMBOL_LENGTH)
  assertLength('uri', args.uri, MAX_URI_LENGTH)

  if (args.sellerFeeBasisPoints < 0 || args.sellerFeeBasisPoints > 10_000) {
    throw new RangeError(`sellerFeeBasisPoints out of range: ${args.sellerFeeBasisPoints}`)
  }

  const creators = args.creators ?? [{ address: args.creator, verified: true, share: 100 }]
  const totalShare = creators.reduce((sum, c) => sum + c.share, 0)
  if (totalShare !== 100) {
    // The program rejects this too, but as an opaque error mid-transaction —
    // after the user has already approved it in their wallet.
    throw new RangeError(`Creator shares must total 100, got ${totalShare}.`)
  }

  const w = new BorshWriter()
    .u8(CREATE_METADATA_V3)
    // --- DataV2
    .string(args.name)
    .string(args.symbol)
    .string(args.uri)
    .u16(args.sellerFeeBasisPoints)

  // creators: Option<Vec<Creator>>
  w.u8(1).u32(creators.length)
  for (const c of creators) {
    w.fixed(c.address.toBytes()).bool(c.verified).u8(c.share)
  }

  w.u8(0) // collection: Option<Collection> — none
  w.u8(0) // uses: Option<Uses> — none
  w.bool(false) // isMutable
  w.u8(0) // collectionDetails: Option<CollectionDetails> — not a collection parent

  const [metadata] = findMetadataPda(args.mint)

  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.creator, isSigner: true, isWritable: false }, // mint authority
      { pubkey: args.creator, isSigner: true, isWritable: true }, // payer
      { pubkey: args.creator, isSigner: false, isWritable: false }, // update authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(concatBytes(w.toBytes())),
  })
}

/**
 * Measured in UTF-8 bytes, not characters.
 *
 * A 32-character name of emoji is 128 bytes on chain and fails a check the
 * user cannot see, so the limit has to be applied the way the program applies
 * it.
 */
function assertLength(field: string, value: string, max: number): void {
  const bytes = new TextEncoder().encode(value).length
  if (bytes > max) {
    throw new RangeError(`${field} is ${bytes} bytes; the on-chain limit is ${max}.`)
  }
}

/** The off-chain JSON document `uri` resolves to. Metaplex's standard schema. */
export interface TokenMetadataJson {
  name: string
  symbol: string
  description: string
  image: string
  /** A live URL rather than a model file — see `buildMetadataJson`. */
  animation_url?: string
  external_url?: string
  attributes: Array<{ trait_type: string; value: string | number }>
  properties: {
    category: string
    files: Array<{ uri: string; type: string }>
    creators?: Array<{ address: string; share: number }>
  }
}
