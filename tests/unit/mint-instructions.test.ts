import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js'
import * as splToken from '@solana/spl-token'
import { describe, expect, it } from 'vitest'
import { buildMintInstructions } from '../../app/utils/mint-instructions'

const creator = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')
const mint = Keypair.generate().publicKey
const creatorAta = splToken.getAssociatedTokenAddressSync(mint, creator)

const createKwamiIx = new TransactionInstruction({
  programId: new PublicKey('DoQubWtmNa4WZTLWxe1iptCDrwf81M8LHDrZDP7pEBbL'),
  keys: [],
  data: Buffer.alloc(0),
})

function build() {
  return buildMintInstructions({
    creator,
    mint,
    creatorAta,
    rent: 1_461_600,
    name: 'Test Kwami',
    metadataUri: 'https://kwami.io/api/kwami/x/metadata',
    sellerFeeBasisPoints: 500,
    createKwamiIx,
    splToken,
  })
}

/** Find the one instruction addressed to the SPL token program with the given first byte. */
function tokenIx(instructions: TransactionInstruction[], discriminant: number) {
  return instructions.find(
    (ix) => ix.programId.equals(splToken.TOKEN_PROGRAM_ID) && ix.data[0] === discriminant,
  )
}

describe('buildMintInstructions', () => {
  it('creates the mint, the token account, the token, the metadata and the vault account', () => {
    const instructions = build()

    // createAccount, initializeMint2, createATA, mintTo, metadata, setAuthority, create_kwami.
    expect(instructions).toHaveLength(7)
    expect(instructions.at(-1)).toBe(createKwamiIx)
  })

  /**
   * The defect this file exists for.
   *
   * `InitializeMint2` takes the freeze authority as an option after the mint authority. Passing
   * the creator there left the minter permanently able to freeze any future holder's token
   * account — a Kwami someone had bought could be made untradeable, and its pot untouchable, by
   * the person who made it. There is no instruction that revokes a freeze authority which was
   * never set to `None`, so this is unfixable after the fact.
   *
   * Layout of InitializeMint2 (discriminant 20): [u8 ix][u8 decimals][32 mint authority]
   * [u8 freeze option][32 freeze authority?]. The option byte must be 0.
   */
  it('sets no freeze authority, ever', () => {
    const ix = tokenIx(build(), 20)

    expect(ix, 'InitializeMint2 must be present').toBeDefined()
    expect(ix!.data[1]).toBe(0) // zero decimals — non-fungible
    expect(ix!.data.subarray(2, 34)).toEqual(Buffer.from(creator.toBytes())) // mint authority
    expect(ix!.data[34], 'freeze authority option byte must be None').toBe(0)
    expect(ix!.data).toHaveLength(35)
  })

  it('revokes mint authority so a second copy can never exist', () => {
    // SetAuthority is discriminant 6; AuthorityType.MintTokens is 0, and the new authority is
    // an option that must be None.
    const ix = tokenIx(build(), 6)

    expect(ix, 'SetAuthority must be present').toBeDefined()
    expect(ix!.data[1]).toBe(splToken.AuthorityType.MintTokens)
    expect(ix!.data[2], 'new mint authority must be None').toBe(0)
  })

  it('mints exactly one token', () => {
    const ix = tokenIx(build(), 7) // MintTo

    expect(ix).toBeDefined()
    expect(Buffer.from(ix!.data.subarray(1, 9)).readBigUInt64LE()).toBe(1n)
  })

  /**
   * Metaplex refuses to write metadata unless the signer still holds mint authority, so the
   * order of these two is not a style choice. Without metadata the token is "Unknown Token" in
   * every wallet and unlistable on every marketplace.
   */
  it('writes metadata before revoking mint authority', () => {
    const instructions = build()
    const metadataAt = instructions.findIndex(
      (ix) => !ix.programId.equals(splToken.TOKEN_PROGRAM_ID) && ix.data.length > 0 && ix !== createKwamiIx,
    )
    const revokeAt = instructions.findIndex((ix) => ix === tokenIx(instructions, 6))

    expect(metadataAt).toBeGreaterThanOrEqual(0)
    expect(metadataAt).toBeLessThan(revokeAt)
  })

  it('creates the token account before minting into it', () => {
    const instructions = build()
    const ataAt = instructions.findIndex((ix) => ix.programId.equals(splToken.ASSOCIATED_TOKEN_PROGRAM_ID))
    const mintToAt = instructions.findIndex((ix) => ix === tokenIx(instructions, 7))

    expect(ataAt).toBeGreaterThanOrEqual(0)
    expect(ataAt).toBeLessThan(mintToAt)
  })

  it('truncates an over-long name to what the metadata program accepts', () => {
    const instructions = buildMintInstructions({
      creator,
      mint,
      creatorAta,
      rent: 1_461_600,
      name: 'x'.repeat(100),
      metadataUri: 'https://kwami.io/api/kwami/x/metadata',
      sellerFeeBasisPoints: 500,
      createKwamiIx,
      splToken,
    })

    // The name is length-prefixed inside the metadata instruction; a 100-character name would
    // make the program reject the whole transaction.
    const metadata = instructions.find(
      (ix) => !ix.programId.equals(splToken.TOKEN_PROGRAM_ID) && ix !== createKwamiIx && ix.data.length > 40,
    )
    expect(metadata).toBeDefined()
    expect(metadata!.data.includes(Buffer.from('x'.repeat(33)))).toBe(false)
  })
})
