/**
 * Reading a payment off a transaction, and deciding what it bought.
 *
 * The Nitro side of energy is mostly plumbing — a Supabase RPC call, an RPC
 * endpoint — but these three decisions are not, and they are the ones that get
 * money wrong if they drift. They live here so they can be tested against
 * numbers rather than against a stubbed cluster.
 */

/**
 * What a transaction actually delivered to one account.
 *
 * Taken from the account's own balance delta rather than by decoding
 * instructions. Decoding would have to keep up with however the bundle happens
 * to be assembled — one transfer, several, a CPI — whereas the balance change
 * is the thing that actually happened, and it is also what the payer's wallet
 * showed them when they approved it.
 *
 * Negative deltas come back as zero. A treasury that somehow *paid out* in a
 * transaction has not bought anybody any energy, and crediting the absolute
 * value would turn a refund into a purchase.
 */
export function treasuryDelta(
  preBalances: readonly number[] | undefined,
  postBalances: readonly number[] | undefined,
  index: number,
): bigint {
  if (index < 0) return 0n
  const before = preBalances?.[index]
  const after = postBalances?.[index]
  if (typeof before !== 'number' || typeof after !== 'number') return 0n
  const delta = BigInt(after) - BigInt(before)
  return delta > 0n ? delta : 0n
}

/**
 * How much of a mint receipt was fuel rather than commission.
 *
 * The mint bundle pays the treasury twice — the flat commission and then the
 * fuel — and both land in one balance delta, so the commission has to come off
 * before anything is credited. Subtracting here rather than recording an
 * intended amount at draft keeps the whole thing derivable from the
 * transaction: whatever the creator paid above the advertised fee is what they
 * were buying energy with.
 *
 * Never negative. A receipt smaller than the commission means the commission
 * was not charged in that bundle at all — an empty treasury adds no instruction
 * — and reading the shortfall as a debt would credit nonsense.
 */
export function fuelAfterCommission(received: bigint, commission: bigint): bigint {
  const fuel = received - commission
  return fuel > 0n ? fuel : 0n
}

/**
 * The configured energy-per-SOL, or the default.
 *
 * Arrives as an environment string, so everything from `undefined` to `'abc'`
 * to `'-5'` has to land somewhere sensible. Falling back rather than throwing:
 * a mistyped deployment variable should not take down the page that quotes a
 * price, it should quote the default one.
 */
export function resolveEnergyPerSol(raw: unknown, fallback: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback
}
