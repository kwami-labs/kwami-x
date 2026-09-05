use anchor_lang::prelude::*;

/// Basis-points denominator, mirrored in `shared/game/constants.ts`.
pub const BPS_DENOMINATOR: u64 = 10_000;

pub const DEFAULT_PAYOUT_BPS: u16 = 8_000;
pub const MIN_PAYOUT_BPS: u16 = 5_000;
pub const MAX_PAYOUT_BPS: u16 = 9_500;

pub const MIN_SESSION_DURATION: i64 = 30;
pub const MAX_SESSION_DURATION: i64 = 900;
pub const DEFAULT_SESSION_DURATION: i64 = 180;

/// Protocol fee ceiling. `Config::fee_bps` may be lowered but never raised past this.
pub const MAX_FEE_BPS: u16 = 500;

/// Share of the protocol fee paid to the original author, in bps of the fee.
pub const AUTHOR_ROYALTY_BPS_OF_FEE: u16 = 4_000;

/// Global protocol settings. One per deployment, at PDA `["config"]`.
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// May update this account and register oracles.
    pub authority: Pubkey,
    /// Receives the protocol's share of every ticket.
    pub treasury: Pubkey,
    /// Ed25519 key whose signatures resolve `Attested` sessions.
    pub oracle: Pubkey,
    /// The one SPL mint accepted as a stablecoin ticket, protocol-wide.
    ///
    /// Without this the USDC leg accepted ANY mint the caller passed: a token you print
    /// yourself buys a real session, and winning it pays out real SOL from the pot. Pinning it
    /// here rather than per-Kwami keeps one decision in one place and lets the authority
    /// migrate it if the canonical mint ever changes.
    pub usdc_mint: Pubkey,
    /// Protocol fee on each ticket, in bps. Capped by `MAX_FEE_BPS`.
    pub fee_bps: u16,
    /// Blocks `start_session` protocol-wide without touching individual Kwamis.
    pub paused: bool,
    pub bump: u8,
}

/// How a winning claim is proven.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ResolutionMode {
    /// Player submits the secret pre-image; the program checks the SHA-256 digest.
    /// Trustless, but the pre-image lands in the ledger, so the Kwami is spent.
    CommitReveal,
    /// `Config::oracle` signs a win attestation that the program verifies via the
    /// ed25519 native program. The secret stays private and the Kwami keeps playing.
    Attested,
}

/// Lifecycle. `Cracked` and `Dead` are terminal.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum KwamiState {
    Minted,
    Live,
    Paused,
    Cracked,
    Dead,
}

/// One per NFT mint, at PDA `["kwami", mint]`.
///
/// Immutable by design: everything that defines the *game* — the secret hash,
/// the prices, the payout split, the resolution mode — is written once at mint
/// and never has a setter. Only `state`, `owner` and the running counters move.
#[account]
#[derive(InitSpace)]
pub struct Kwami {
    /// The Metaplex Core asset that represents this Kwami.
    pub mint: Pubkey,
    /// Wallet that minted it. Immutable; earns the author royalty forever.
    pub author: Pubkey,
    /// Current NFT holder. Synced by `sync_owner` after a marketplace trade.
    pub owner: Pubkey,
    /// `sha256(normalize(secret) || 0x1f || salt)`. Immutable.
    pub secret_hash: [u8; 32],
    /// Ticket price in lamports. Zero disables SOL tickets.
    pub ticket_price_lamports: u64,
    /// Ticket price in USDC base units (6 dp). Zero disables USDC tickets.
    pub ticket_price_usdc: u64,
    pub session_duration: i64,
    pub payout_bps: u16,
    pub resolution_mode: ResolutionMode,
    pub state: KwamiState,
    /// Highest vault value ever recorded, in USD cents — the drawdown baseline.
    pub high_water_mark_cents: u64,
    /// Total tickets ever sold. Doubles as the per-Kwami session nonce source.
    pub sessions_played: u64,
    /// Unix seconds until which the pot may not be withdrawn.
    ///
    /// Set to the latest open session's `expires_at` every time a ticket is sold. Without it an
    /// owner could `pause` and `withdraw` in a single transaction and empty the pot while a
    /// challenger — who has already paid — still had time on the clock. A deadline rather than
    /// an open-session counter because nothing on chain decrements a counter when a session
    /// simply runs out, so a counter would leak and lock the pot forever.
    pub pot_locked_until: i64,
    pub sessions_won: u64,
    /// Set when a `CommitReveal` win publishes the pre-image.
    pub secret_revealed: bool,
    /// Optional sub-program invoked by CPI on lifecycle events. `None` == `Pubkey::default()`.
    pub extension: Pubkey,
    pub vault_bump: u8,
    pub bump: u8,
}

impl Kwami {
    /// Whether the owner may take funds out of the vault right now.
    ///
    /// Two rules, both of which were previously spelled out inline in each of the two
    /// withdrawal handlers:
    ///
    /// 1. The Kwami must not be `Live`. A live Kwami is one people are buying tickets for.
    /// 2. No sold challenge may still be claimable. `pause` is a single instruction and
    ///    withdrawal is another, so without this an owner could pause and drain the pot in one
    ///    transaction while a challenger who had already paid still had time on the clock.
    ///
    /// Pure, so it can be tested without a validator — which is the whole reason it is a
    /// function rather than two copies of a `require!`.
    pub fn may_withdraw(&self, now: i64) -> bool {
        matches!(
            self.state,
            KwamiState::Minted | KwamiState::Paused | KwamiState::Dead | KwamiState::Cracked
        ) && now >= self.pot_locked_until
    }

    /// Extend the withdrawal lock to cover a newly sold challenge.
    ///
    /// Monotonic: an earlier-expiring session must never shorten a lock a later one set.
    pub fn lock_pot_until(&mut self, expires_at: i64) {
        self.pot_locked_until = self.pot_locked_until.max(expires_at);
    }
}

/// Which asset a ticket was paid in.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Asset {
    Sol,
    Usdc,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum SessionOutcome {
    Pending,
    Won,
    Expired,
}

/// A three-minute challenge, at PDA `["session", mint, player, nonce_le]`.
#[account]
#[derive(InitSpace)]
pub struct Session {
    pub kwami: Pubkey,
    pub player: Pubkey,
    pub nonce: u64,
    pub asset: Asset,
    /// Gross ticket, before the protocol fee.
    pub ticket_amount: u64,
    pub started_at: i64,
    pub expires_at: i64,
    pub outcome: SessionOutcome,
    /// Paid out on a win, recorded for the receipt.
    pub payout_lamports: u64,
    pub payout_usdc: u64,
    pub bump: u8,
}

/// Registration record for an AI-generated sub-program, at PDA `["extension", mint]`.
///
/// The builder compiles an owner-authored game into its own program; this
/// account is the Kwami's opt-in to being driven by it. Registration is
/// one-way and only possible before the Kwami first goes live, so a published
/// Kwami's rules cannot change under a challenger's feet.
#[account]
#[derive(InitSpace)]
pub struct Extension {
    pub kwami: Pubkey,
    pub program: Pubkey,
    /// SHA-256 of the deployed program binary at registration time. Anyone can
    /// re-derive it from the ledger to prove the code was never swapped.
    pub code_hash: [u8; 32],
    /// Which lifecycle events trigger a CPI. Bit 0 start, 1 win, 2 expiry, 3 death.
    pub hooks: u8,
    pub registered_at: i64,
    pub bump: u8,
}

pub mod hook {
    pub const ON_SESSION_START: u8 = 1 << 0;
    pub const ON_WIN: u8 = 1 << 1;
    pub const ON_EXPIRE: u8 = 1 << 2;
    pub const ON_DEATH: u8 = 1 << 3;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kwami(state: KwamiState, pot_locked_until: i64) -> Kwami {
        Kwami {
            mint: Pubkey::default(),
            author: Pubkey::default(),
            owner: Pubkey::default(),
            secret_hash: [0u8; 32],
            ticket_price_lamports: 0,
            ticket_price_usdc: 0,
            session_duration: 180,
            payout_bps: 8_000,
            resolution_mode: ResolutionMode::CommitReveal,
            state,
            high_water_mark_cents: 0,
            sessions_played: 0,
            pot_locked_until,
            sessions_won: 0,
            secret_revealed: false,
            extension: Pubkey::default(),
            vault_bump: 0,
            bump: 0,
        }
    }

    #[test]
    fn a_live_kwami_never_lets_its_pot_be_withdrawn() {
        assert!(!kwami(KwamiState::Live, 0).may_withdraw(1_000));
    }

    #[test]
    fn a_settled_kwami_lets_its_owner_withdraw() {
        for state in [
            KwamiState::Minted,
            KwamiState::Paused,
            KwamiState::Dead,
            KwamiState::Cracked,
        ] {
            assert!(
                kwami(state, 0).may_withdraw(1_000),
                "{state:?} should allow it"
            );
        }
    }

    /// The drain this lock exists to stop: `pause` and `withdraw` are separate instructions, so
    /// an owner could pause a Live Kwami and empty the pot in the same transaction while a
    /// challenger who had already paid still had time on the clock.
    #[test]
    fn pausing_does_not_release_a_pot_a_challenger_can_still_win() {
        let paused_mid_session = kwami(KwamiState::Paused, 2_000);

        assert!(!paused_mid_session.may_withdraw(1_999), "still claimable");
        assert!(
            paused_mid_session.may_withdraw(2_000),
            "the moment it expires"
        );
        assert!(paused_mid_session.may_withdraw(2_001));
    }

    #[test]
    fn the_lock_only_ever_moves_forward() {
        let mut k = kwami(KwamiState::Live, 0);

        k.lock_pot_until(5_000);
        assert_eq!(k.pot_locked_until, 5_000);

        // A second, shorter session must not shorten the first one's protection.
        k.lock_pot_until(4_000);
        assert_eq!(k.pot_locked_until, 5_000);

        k.lock_pot_until(9_000);
        assert_eq!(k.pot_locked_until, 9_000);
    }
}
