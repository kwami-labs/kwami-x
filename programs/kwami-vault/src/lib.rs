//! # Kwami Vault
//!
//! Each Kwami NFT owns a pot. Anyone may buy a ticket to talk to it for three
//! minutes; if they say its secret phrase before the clock runs out they take
//! 80% of the pot. If they don't, the ticket stays and the pot grows. A Kwami
//! that loses 99% of its peak value — or falls under a dollar — dies.
//!
//! ## Trust model
//!
//! The conversation happens off chain (voice, STT, an LLM), but *settlement
//! never trusts the conversation*. There are two ways a win can be proven:
//!
//! * **Commit-reveal** — the Kwami commits to `sha256(secret || salt)` at mint.
//!   A winner submits the pre-image and the program checks the digest itself.
//!   Nothing off chain can fake a win or deny a real one. The cost is that the
//!   pre-image is public afterwards, so the Kwami becomes `Cracked`.
//! * **Attested** — a registered oracle signs a win certificate that the
//!   program verifies through the ed25519 native program. The secret stays
//!   private and the Kwami keeps earning, at the cost of trusting the oracle
//!   not to forge or withhold certificates.
//!
//! Owners pick per Kwami at mint. Neither mode lets the *owner* decide whether
//! a challenger won.
//!
//! ## Immutability
//!
//! Everything that defines the game is written once in `create_kwami` and has
//! no setter: secret hash, both ticket prices, session length, payout split,
//! resolution mode and the extension program. What moves is the pot, the
//! counters, the lifecycle state and — on a marketplace sale — the owner.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

pub mod attestation;
pub mod errors;
pub mod math;
pub mod state;

use attestation::{verify_oracle_signature, WinAttestation};
use errors::KwamiError;
use math::{apply_bps, is_drawdown_dead, is_dust_dead, split_ticket};
use state::*;

declare_id!("DoQubWtmNa4WZTLWxe1iptCDrwf81M8LHDrZDP7pEBbL");

/// Guards against a caller pushing a huge buffer through the SHA-256 check.
const MAX_PREIMAGE_LEN: usize = 256;

#[program]
pub mod kwami_vault {
    use super::*;

    // ---------------------------------------------------------------- config

    pub fn initialize_config(ctx: Context<InitializeConfig>, fee_bps: u16, oracle: Pubkey) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, KwamiError::FeeTooHigh);
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.treasury = ctx.accounts.treasury.key();
        config.oracle = oracle;
        config.fee_bps = fee_bps;
        config.paused = false;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Adjust protocol-level knobs. Cannot raise the fee past `MAX_FEE_BPS`,
    /// so a compromised authority cannot silently tax pots to zero.
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        fee_bps: Option<u16>,
        oracle: Option<Pubkey>,
        paused: Option<bool>,
        treasury: Option<Pubkey>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        if let Some(bps) = fee_bps {
            require!(bps <= MAX_FEE_BPS, KwamiError::FeeTooHigh);
            config.fee_bps = bps;
        }
        if let Some(o) = oracle {
            config.oracle = o;
        }
        if let Some(p) = paused {
            config.paused = p;
        }
        if let Some(t) = treasury {
            config.treasury = t;
        }
        Ok(())
    }

    // ----------------------------------------------------------------- mint

    /// Create the on-chain half of a Kwami alongside its NFT.
    ///
    /// The client mints the Metaplex Core asset in the same transaction and
    /// passes its address here, so a Kwami account can never exist without a
    /// matching NFT.
    pub fn create_kwami(
        ctx: Context<CreateKwami>,
        secret_hash: [u8; 32],
        ticket_price_lamports: u64,
        ticket_price_usdc: u64,
        session_duration: i64,
        payout_bps: u16,
        resolution_mode: ResolutionMode,
    ) -> Result<()> {
        require!(
            ticket_price_lamports > 0 || ticket_price_usdc > 0,
            KwamiError::NoTicketPrice
        );
        require!(
            (MIN_PAYOUT_BPS..=MAX_PAYOUT_BPS).contains(&payout_bps),
            KwamiError::PayoutOutOfRange
        );
        require!(
            (MIN_SESSION_DURATION..=MAX_SESSION_DURATION).contains(&session_duration),
            KwamiError::DurationOutOfRange
        );

        let kwami = &mut ctx.accounts.kwami;
        kwami.mint = ctx.accounts.mint.key();
        kwami.author = ctx.accounts.creator.key();
        kwami.owner = ctx.accounts.creator.key();
        kwami.secret_hash = secret_hash;
        kwami.ticket_price_lamports = ticket_price_lamports;
        kwami.ticket_price_usdc = ticket_price_usdc;
        kwami.session_duration = session_duration;
        kwami.payout_bps = payout_bps;
        kwami.resolution_mode = resolution_mode;
        kwami.state = KwamiState::Minted;
        kwami.high_water_mark_cents = 0;
        kwami.sessions_played = 0;
        kwami.sessions_won = 0;
        kwami.secret_revealed = false;
        kwami.extension = Pubkey::default();
        kwami.vault_bump = ctx.bumps.vault;
        kwami.bump = ctx.bumps.kwami;

        emit!(KwamiCreated {
            mint: kwami.mint,
            author: kwami.author,
            ticket_price_lamports,
            ticket_price_usdc,
            payout_bps,
        });
        Ok(())
    }

    /// Open the Kwami to challengers.
    pub fn publish(ctx: Context<OwnerAction>) -> Result<()> {
        let kwami = &mut ctx.accounts.kwami;
        require!(
            matches!(kwami.state, KwamiState::Minted | KwamiState::Paused),
            KwamiError::NotLive
        );
        kwami.state = KwamiState::Live;
        emit!(KwamiPublished { mint: kwami.mint });
        Ok(())
    }

    /// Stop selling tickets. Sessions already running still settle normally.
    pub fn pause(ctx: Context<OwnerAction>) -> Result<()> {
        let kwami = &mut ctx.accounts.kwami;
        require!(kwami.state == KwamiState::Live, KwamiError::NotLive);
        kwami.state = KwamiState::Paused;
        Ok(())
    }

    /// Point `Kwami::owner` at whoever currently holds the NFT.
    ///
    /// The NFT is freely tradable, so ownership can change without this program
    /// being involved. Anyone may call this — it is permissionless bookkeeping
    /// that only ever copies the token account's authority — which means a
    /// buyer is never locked out by a seller who declines to hand over.
    pub fn sync_owner(ctx: Context<SyncOwner>) -> Result<()> {
        require!(ctx.accounts.nft_token.amount == 1, KwamiError::NotNftHolder);
        let holder = ctx.accounts.nft_token.owner;
        let kwami = &mut ctx.accounts.kwami;
        let previous = kwami.owner;
        kwami.owner = holder;
        emit!(OwnerSynced {
            mint: kwami.mint,
            previous,
            current: holder,
        });
        Ok(())
    }

    // -------------------------------------------------------------- sessions

    /// Buy a ticket in SOL and start the clock.
    pub fn start_session_sol(ctx: Context<StartSessionSol>, nonce: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, KwamiError::ProtocolPaused);

        let kwami = &ctx.accounts.kwami;
        assert_playable(kwami)?;
        require!(kwami.ticket_price_lamports > 0, KwamiError::AssetNotAccepted);
        require!(nonce == kwami.sessions_played, KwamiError::SessionActive);

        let ticket = kwami.ticket_price_lamports;
        let split = split_ticket(ticket, config.fee_bps)?;

        // Three transfers rather than one plus internal accounting: the vault
        // PDA is system-owned and holds only pot funds, so its lamport balance
        // is the pot. Nothing has to be netted off at payout time.
        transfer_sol(
            &ctx.accounts.player.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            split.to_vault,
            &ctx.accounts.system_program,
        )?;
        transfer_sol(
            &ctx.accounts.player.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            split.to_protocol,
            &ctx.accounts.system_program,
        )?;
        transfer_sol(
            &ctx.accounts.player.to_account_info(),
            &ctx.accounts.author.to_account_info(),
            split.to_author,
            &ctx.accounts.system_program,
        )?;

        let now = Clock::get()?.unix_timestamp;
        init_session(
            &mut ctx.accounts.session,
            ctx.accounts.kwami.key(),
            ctx.accounts.player.key(),
            nonce,
            Asset::Sol,
            ticket,
            now,
            ctx.accounts.kwami.session_duration,
            ctx.bumps.session,
        );

        let kwami = &mut ctx.accounts.kwami;
        kwami.sessions_played = kwami.sessions_played.checked_add(1).ok_or(KwamiError::MathOverflow)?;

        emit!(SessionStarted {
            mint: kwami.mint,
            session: ctx.accounts.session.key(),
            player: ctx.accounts.player.key(),
            asset: Asset::Sol,
            ticket_amount: ticket,
            expires_at: ctx.accounts.session.expires_at,
        });
        Ok(())
    }

    /// Buy a ticket in USDC and start the clock.
    pub fn start_session_usdc(ctx: Context<StartSessionUsdc>, nonce: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, KwamiError::ProtocolPaused);

        let kwami = &ctx.accounts.kwami;
        assert_playable(kwami)?;
        require!(kwami.ticket_price_usdc > 0, KwamiError::AssetNotAccepted);
        require!(nonce == kwami.sessions_played, KwamiError::SessionActive);

        let ticket = kwami.ticket_price_usdc;
        let split = split_ticket(ticket, config.fee_bps)?;
        let decimals = ctx.accounts.usdc_mint.decimals;

        transfer_spl(
            &ctx.accounts.token_program,
            &ctx.accounts.player_usdc,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.vault_usdc,
            &ctx.accounts.player.to_account_info(),
            split.to_vault,
            decimals,
        )?;
        transfer_spl(
            &ctx.accounts.token_program,
            &ctx.accounts.player_usdc,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.treasury_usdc,
            &ctx.accounts.player.to_account_info(),
            split.to_protocol,
            decimals,
        )?;
        transfer_spl(
            &ctx.accounts.token_program,
            &ctx.accounts.player_usdc,
            &ctx.accounts.usdc_mint,
            &ctx.accounts.author_usdc,
            &ctx.accounts.player.to_account_info(),
            split.to_author,
            decimals,
        )?;

        let now = Clock::get()?.unix_timestamp;
        init_session(
            &mut ctx.accounts.session,
            ctx.accounts.kwami.key(),
            ctx.accounts.player.key(),
            nonce,
            Asset::Usdc,
            ticket,
            now,
            ctx.accounts.kwami.session_duration,
            ctx.bumps.session,
        );

        let kwami = &mut ctx.accounts.kwami;
        kwami.sessions_played = kwami.sessions_played.checked_add(1).ok_or(KwamiError::MathOverflow)?;

        emit!(SessionStarted {
            mint: kwami.mint,
            session: ctx.accounts.session.key(),
            player: ctx.accounts.player.key(),
            asset: Asset::Usdc,
            ticket_amount: ticket,
            expires_at: ctx.accounts.session.expires_at,
        });
        Ok(())
    }

    /// Claim a win by revealing the secret pre-image.
    ///
    /// Pays `payout_bps` of *both* vault assets, so the winner's share does not
    /// depend on a price feed and settlement needs no swap route.
    pub fn claim_win_reveal(ctx: Context<ClaimWin>, preimage: Vec<u8>) -> Result<()> {
        require!(preimage.len() <= MAX_PREIMAGE_LEN, KwamiError::PreimageTooLong);
        require!(
            ctx.accounts.kwami.resolution_mode == ResolutionMode::CommitReveal,
            KwamiError::WrongResolutionMode
        );

        let digest = hash(&preimage).to_bytes();
        require!(digest == ctx.accounts.kwami.secret_hash, KwamiError::WrongSecret);

        settle_win(&mut ctx.accounts.into_settlement()?)?;

        let kwami = &mut ctx.accounts.kwami;
        // The pre-image is now in the ledger for anyone to replay, so the game
        // is over for this Kwami. Retiring it here is what keeps the trustless
        // mode honest rather than a one-shot exploit for the next challenger.
        kwami.secret_revealed = true;
        kwami.state = KwamiState::Cracked;
        Ok(())
    }

    /// Claim a win with an oracle-signed attestation.
    ///
    /// Requires a matching `Ed25519Program` instruction immediately before this
    /// one in the same transaction; see `attestation::verify_oracle_signature`.
    pub fn claim_win_attested(ctx: Context<ClaimWinAttested>, valid_until: i64) -> Result<()> {
        require!(
            ctx.accounts.inner.kwami.resolution_mode == ResolutionMode::Attested,
            KwamiError::WrongResolutionMode
        );

        let now = Clock::get()?.unix_timestamp;
        let att = WinAttestation {
            session: ctx.accounts.inner.session.key(),
            player: ctx.accounts.inner.player.key(),
            valid_until,
        };
        verify_oracle_signature(
            &ctx.accounts.instructions_sysvar,
            &ctx.accounts.inner.config.oracle,
            &att,
            now,
        )?;

        settle_win(&mut ctx.accounts.inner.into_settlement()?)?;
        Ok(())
    }

    /// Close an expired, unwon session and return its rent to the player.
    ///
    /// The ticket stays in the pot — that is the whole economy. Permissionless
    /// so a keeper can reclaim rent even if the player walks away.
    pub fn settle_session(ctx: Context<SettleSession>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let session = &mut ctx.accounts.session;
        require!(session.outcome == SessionOutcome::Pending, KwamiError::SessionResolved);
        require!(now >= session.expires_at, KwamiError::SessionActive);
        session.outcome = SessionOutcome::Expired;
        emit!(SessionExpired {
            mint: ctx.accounts.kwami.mint,
            session: session.key(),
            player: session.player,
        });
        Ok(())
    }

    // -------------------------------------------------------------- vitality

    /// Record the vault's USD valuation and apply the death rules.
    ///
    /// Solana cannot price a mixed SOL/USDC vault on its own, so the oracle
    /// pushes a valuation. It can only ever *raise* the high-water mark or
    /// declare death — it can never move funds — so a faulty oracle can kill a
    /// Kwami but not steal from one.
    pub fn record_valuation(ctx: Context<RecordValuation>, value_cents: u64) -> Result<()> {
        let kwami = &mut ctx.accounts.kwami;
        if matches!(kwami.state, KwamiState::Dead | KwamiState::Cracked) {
            return Ok(());
        }

        if value_cents > kwami.high_water_mark_cents {
            kwami.high_water_mark_cents = value_cents;
        }

        let funded = kwami.high_water_mark_cents > 0;
        if funded && (is_dust_dead(value_cents) || is_drawdown_dead(value_cents, kwami.high_water_mark_cents)) {
            kwami.state = KwamiState::Dead;
            emit!(KwamiDied {
                mint: kwami.mint,
                value_cents,
                high_water_mark_cents: kwami.high_water_mark_cents,
            });
        }
        Ok(())
    }

    // ------------------------------------------------------------- treasury

    /// Owner withdraws SOL from the vault.
    ///
    /// Only while unpublished or after death — a live Kwami's pot belongs to
    /// the game, and letting an owner drain it mid-session would make every
    /// ticket a scam.
    pub fn withdraw_sol(ctx: Context<WithdrawSol>, amount: u64) -> Result<()> {
        let kwami = &ctx.accounts.kwami;
        require!(
            matches!(kwami.state, KwamiState::Minted | KwamiState::Paused | KwamiState::Dead | KwamiState::Cracked),
            KwamiError::WithdrawNotAllowed
        );

        let vault = ctx.accounts.vault.to_account_info();
        let rent_floor = Rent::get()?.minimum_balance(vault.data_len());
        let available = vault.lamports().saturating_sub(rent_floor);
        require!(amount <= available, KwamiError::InsufficientVault);

        **vault.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += amount;
        Ok(())
    }

    /// Owner withdraws USDC from the vault, under the same lifecycle rule.
    pub fn withdraw_usdc(ctx: Context<WithdrawUsdc>, amount: u64) -> Result<()> {
        let kwami = &ctx.accounts.kwami;
        require!(
            matches!(kwami.state, KwamiState::Minted | KwamiState::Paused | KwamiState::Dead | KwamiState::Cracked),
            KwamiError::WithdrawNotAllowed
        );
        require!(ctx.accounts.vault_usdc.amount >= amount, KwamiError::InsufficientVault);

        let mint_key = kwami.mint;
        let seeds: &[&[u8]] = &[b"vault", mint_key.as_ref(), &[kwami.vault_bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.owner_usdc.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.usdc_mint.decimals,
        )
    }

    // ------------------------------------------------------------ extensions

    /// Attach an AI-generated sub-program to this Kwami.
    ///
    /// Only before the Kwami first goes live, and only once. A challenger who
    /// reads the rules before paying is guaranteed those are the rules that
    /// will settle their session.
    pub fn register_extension(ctx: Context<RegisterExtension>, code_hash: [u8; 32], hooks: u8) -> Result<()> {
        let kwami = &mut ctx.accounts.kwami;
        require!(kwami.state == KwamiState::Minted, KwamiError::ExtensionLocked);
        require!(kwami.extension == Pubkey::default(), KwamiError::ExtensionAlreadyRegistered);

        let ext = &mut ctx.accounts.extension;
        ext.kwami = kwami.key();
        ext.program = ctx.accounts.extension_program.key();
        ext.code_hash = code_hash;
        ext.hooks = hooks;
        ext.registered_at = Clock::get()?.unix_timestamp;
        ext.bump = ctx.bumps.extension;

        kwami.extension = ext.program;
        emit!(ExtensionRegistered {
            mint: kwami.mint,
            program: ext.program,
            hooks,
        });
        Ok(())
    }
}

// ============================================================ shared helpers

fn assert_playable(kwami: &Kwami) -> Result<()> {
    match kwami.state {
        KwamiState::Live => Ok(()),
        KwamiState::Dead => Err(KwamiError::KwamiDead.into()),
        KwamiState::Cracked => Err(KwamiError::KwamiCracked.into()),
        _ => Err(KwamiError::NotLive.into()),
    }
}

fn transfer_sol<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    lamports: u64,
    system_program: &Program<'info, System>,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    invoke(
        &system_instruction::transfer(from.key, to.key, lamports),
        &[from.clone(), to.clone(), system_program.to_account_info()],
    )
    .map_err(Into::into)
}

fn transfer_spl<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new(
            token_program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: authority.clone(),
            },
        ),
        amount,
        decimals,
    )
}

#[allow(clippy::too_many_arguments)]
fn init_session(
    session: &mut Account<Session>,
    kwami: Pubkey,
    player: Pubkey,
    nonce: u64,
    asset: Asset,
    ticket_amount: u64,
    now: i64,
    duration: i64,
    bump: u8,
) {
    session.kwami = kwami;
    session.player = player;
    session.nonce = nonce;
    session.asset = asset;
    session.ticket_amount = ticket_amount;
    session.started_at = now;
    session.expires_at = now + duration;
    session.outcome = SessionOutcome::Pending;
    session.payout_lamports = 0;
    session.payout_usdc = 0;
    session.bump = bump;
}

/// The account set a win settlement touches, gathered so both claim paths
/// share one implementation and cannot drift apart.
struct Settlement<'a, 'info> {
    kwami: &'a mut Account<'info, Kwami>,
    session: &'a mut Account<'info, Session>,
    vault: AccountInfo<'info>,
    vault_usdc: Option<InterfaceAccount<'info, TokenAccount>>,
    player: AccountInfo<'info>,
    player_usdc: Option<InterfaceAccount<'info, TokenAccount>>,
    usdc_mint: Option<InterfaceAccount<'info, Mint>>,
    token_program: Option<Interface<'info, TokenInterface>>,
    now: i64,
}

/// Pay out a win and mark the session settled.
///
/// Deliberately re-checks expiry and the pending flag even though both claim
/// paths already validated their proof: the proof says *the player knew the
/// secret*, not *they were still inside the window*.
fn settle_win(s: &mut Settlement) -> Result<()> {
    require!(s.session.outcome == SessionOutcome::Pending, KwamiError::SessionResolved);
    require!(s.now < s.session.expires_at, KwamiError::SessionExpired);

    let payout_bps = s.kwami.payout_bps;

    // --- SOL leg. The vault PDA is system-owned, so its rent-exempt minimum
    // is not part of the pot and must not be paid out.
    let rent_floor = Rent::get()?.minimum_balance(s.vault.data_len());
    let pot_lamports = s.vault.lamports().saturating_sub(rent_floor);
    let payout_lamports = apply_bps(pot_lamports, payout_bps)?;
    if payout_lamports > 0 {
        **s.vault.try_borrow_mut_lamports()? -= payout_lamports;
        **s.player.try_borrow_mut_lamports()? += payout_lamports;
    }

    // --- USDC leg, when the Kwami holds any.
    let mut payout_usdc = 0u64;
    if let (Some(vault_usdc), Some(player_usdc), Some(mint), Some(token_program)) = (
        s.vault_usdc.as_ref(),
        s.player_usdc.as_ref(),
        s.usdc_mint.as_ref(),
        s.token_program.as_ref(),
    ) {
        payout_usdc = apply_bps(vault_usdc.amount, payout_bps)?;
        if payout_usdc > 0 {
            let mint_key = s.kwami.mint;
            let seeds: &[&[u8]] = &[b"vault", mint_key.as_ref(), &[s.kwami.vault_bump]];
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    TransferChecked {
                        from: vault_usdc.to_account_info(),
                        mint: mint.to_account_info(),
                        to: player_usdc.to_account_info(),
                        authority: s.vault.clone(),
                    },
                    &[seeds],
                ),
                payout_usdc,
                mint.decimals,
            )?;
        }
    }

    s.session.outcome = SessionOutcome::Won;
    s.session.payout_lamports = payout_lamports;
    s.session.payout_usdc = payout_usdc;
    s.kwami.sessions_won = s.kwami.sessions_won.checked_add(1).ok_or(KwamiError::MathOverflow)?;

    emit!(SessionWon {
        mint: s.kwami.mint,
        session: s.session.key(),
        player: s.session.player,
        payout_lamports,
        payout_usdc,
    });
    Ok(())
}

// ============================================================ account structs

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: only stored as a payout destination.
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateKwami<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + Kwami::INIT_SPACE,
        seeds = [b"kwami", mint.key().as_ref()],
        bump
    )]
    pub kwami: Account<'info, Kwami>,
    /// The pot. System-owned so its lamport balance *is* the SOL pot, with no
    /// separate accounting to keep in sync.
    /// CHECK: PDA validated by seeds; never carries data.
    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump
    )]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: the Metaplex Core asset minted in the same transaction.
    pub mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerAction<'info> {
    #[account(
        mut,
        seeds = [b"kwami", kwami.mint.as_ref()],
        bump = kwami.bump,
        constraint = kwami.owner == owner.key() @ KwamiError::NotOwner
    )]
    pub kwami: Account<'info, Kwami>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct SyncOwner<'info> {
    #[account(mut, seeds = [b"kwami", kwami.mint.as_ref()], bump = kwami.bump)]
    pub kwami: Account<'info, Kwami>,
    #[account(constraint = nft_token.mint == kwami.mint @ KwamiError::NotNftHolder)]
    pub nft_token: InterfaceAccount<'info, TokenAccount>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct StartSessionSol<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"kwami", kwami.mint.as_ref()], bump = kwami.bump)]
    pub kwami: Account<'info, Kwami>,
    /// CHECK: PDA validated by seeds.
    #[account(mut, seeds = [b"vault", kwami.mint.as_ref()], bump = kwami.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = player,
        space = 8 + Session::INIT_SPACE,
        seeds = [b"session", kwami.mint.as_ref(), player.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub session: Account<'info, Session>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: must match the configured treasury.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: must match the Kwami's immutable author.
    #[account(mut, address = kwami.author)]
    pub author: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct StartSessionUsdc<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"kwami", kwami.mint.as_ref()], bump = kwami.bump)]
    pub kwami: Account<'info, Kwami>,
    /// CHECK: PDA validated by seeds; authority over `vault_usdc`.
    #[account(seeds = [b"vault", kwami.mint.as_ref()], bump = kwami.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = player,
        space = 8 + Session::INIT_SPACE,
        seeds = [b"session", kwami.mint.as_ref(), player.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub session: Account<'info, Session>,
    #[account(mut)]
    pub player: Signer<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = usdc_mint, token::authority = player)]
    pub player_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = player,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault
    )]
    pub vault_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint)]
    pub treasury_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint)]
    pub author_usdc: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimWin<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"kwami", kwami.mint.as_ref()], bump = kwami.bump)]
    pub kwami: Account<'info, Kwami>,
    /// CHECK: PDA validated by seeds.
    #[account(
        mut,
        seeds = [b"vault", kwami.mint.as_ref()],
        bump = kwami.vault_bump
    )]
    pub vault: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"session", kwami.mint.as_ref(), player.key().as_ref(), &session.nonce.to_le_bytes()],
        bump = session.bump,
        constraint = session.kwami == kwami.key() @ KwamiError::AttestationMismatch,
        constraint = session.player == player.key() @ KwamiError::AttestationMismatch
    )]
    pub session: Account<'info, Session>,
    #[account(mut)]
    pub player: Signer<'info>,

    // The USDC leg is optional: a Kwami that only ever sold SOL tickets has no
    // token accounts, and requiring them would make winning impossible.
    pub usdc_mint: Option<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub vault_usdc: Option<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub player_usdc: Option<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Option<Interface<'info, TokenInterface>>,
}

impl<'info> ClaimWin<'info> {
    fn into_settlement(&mut self) -> Result<Settlement<'_, 'info>> {
        Ok(Settlement {
            now: Clock::get()?.unix_timestamp,
            kwami: &mut self.kwami,
            session: &mut self.session,
            vault: self.vault.to_account_info(),
            vault_usdc: self.vault_usdc.clone(),
            player: self.player.to_account_info(),
            player_usdc: self.player_usdc.clone(),
            usdc_mint: self.usdc_mint.clone(),
            token_program: self.token_program.clone(),
        })
    }
}

#[derive(Accounts)]
pub struct ClaimWinAttested<'info> {
    pub inner: ClaimWin<'info>,
    /// CHECK: address-checked against the instructions sysvar.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleSession<'info> {
    #[account(seeds = [b"kwami", kwami.mint.as_ref()], bump = kwami.bump)]
    pub kwami: Account<'info, Kwami>,
    #[account(
        mut,
        close = player,
        constraint = session.kwami == kwami.key() @ KwamiError::AttestationMismatch
    )]
    pub session: Account<'info, Session>,
    /// CHECK: rent recipient; must be the session's player.
    #[account(mut, address = session.player)]
    pub player: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RecordValuation<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"kwami", kwami.mint.as_ref()], bump = kwami.bump)]
    pub kwami: Account<'info, Kwami>,
    #[account(address = config.oracle @ KwamiError::StalePrice)]
    pub oracle: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(
        seeds = [b"kwami", kwami.mint.as_ref()],
        bump = kwami.bump,
        constraint = kwami.owner == owner.key() @ KwamiError::NotOwner
    )]
    pub kwami: Account<'info, Kwami>,
    /// CHECK: PDA validated by seeds.
    #[account(mut, seeds = [b"vault", kwami.mint.as_ref()], bump = kwami.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawUsdc<'info> {
    #[account(
        seeds = [b"kwami", kwami.mint.as_ref()],
        bump = kwami.bump,
        constraint = kwami.owner == owner.key() @ KwamiError::NotOwner
    )]
    pub kwami: Account<'info, Kwami>,
    /// CHECK: PDA validated by seeds; authority over `vault_usdc`.
    #[account(seeds = [b"vault", kwami.mint.as_ref()], bump = kwami.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = usdc_mint, token::authority = vault)]
    pub vault_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, token::authority = owner)]
    pub owner_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RegisterExtension<'info> {
    #[account(
        mut,
        seeds = [b"kwami", kwami.mint.as_ref()],
        bump = kwami.bump,
        constraint = kwami.owner == owner.key() @ KwamiError::NotOwner
    )]
    pub kwami: Account<'info, Kwami>,
    #[account(
        init,
        payer = owner,
        space = 8 + Extension::INIT_SPACE,
        seeds = [b"extension", kwami.mint.as_ref()],
        bump
    )]
    pub extension: Account<'info, Extension>,
    /// CHECK: the deployed sub-program; only its address is recorded.
    #[account(executable)]
    pub extension_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ================================================================== events

#[event]
pub struct KwamiCreated {
    pub mint: Pubkey,
    pub author: Pubkey,
    pub ticket_price_lamports: u64,
    pub ticket_price_usdc: u64,
    pub payout_bps: u16,
}

#[event]
pub struct KwamiPublished {
    pub mint: Pubkey,
}

#[event]
pub struct OwnerSynced {
    pub mint: Pubkey,
    pub previous: Pubkey,
    pub current: Pubkey,
}

#[event]
pub struct SessionStarted {
    pub mint: Pubkey,
    pub session: Pubkey,
    pub player: Pubkey,
    pub asset: Asset,
    pub ticket_amount: u64,
    pub expires_at: i64,
}

#[event]
pub struct SessionWon {
    pub mint: Pubkey,
    pub session: Pubkey,
    pub player: Pubkey,
    pub payout_lamports: u64,
    pub payout_usdc: u64,
}

#[event]
pub struct SessionExpired {
    pub mint: Pubkey,
    pub session: Pubkey,
    pub player: Pubkey,
}

#[event]
pub struct KwamiDied {
    pub mint: Pubkey,
    pub value_cents: u64,
    pub high_water_mark_cents: u64,
}

#[event]
pub struct ExtensionRegistered {
    pub mint: Pubkey,
    pub program: Pubkey,
    pub hooks: u8,
}
