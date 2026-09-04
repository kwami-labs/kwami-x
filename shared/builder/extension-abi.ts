/**
 * The Kwami extension ABI.
 *
 * A Kwami owner can attach one sub-program that the vault calls by CPI at
 * lifecycle moments. This is what turns "guess the phrase" into an authorable
 * financial game: an extension can escalate the ticket price with every failed
 * attempt, split payouts between several winners, run a jackpot that only pays
 * on the tenth loss, or gate entry to holders of some other token.
 *
 * The contract is deliberately narrow. An extension is called *after* the vault
 * has already applied its own rules, it is passed a read-only view of the
 * session, and it has no authority over the vault PDA. It can maintain its own
 * state and move its own funds; it cannot reach into the pot. That boundary is
 * what makes it safe to let a language model write one.
 */

export interface ExtensionHook {
  name: string
  bit: number
  /** Discriminator name the vault uses when it invokes the extension. */
  instruction: string
  description: string
  /** Accounts the vault passes, in order. */
  accounts: string[]
}

export const EXTENSION_HOOKS: ExtensionHook[] = [
  {
    name: 'onSessionStart',
    bit: 1 << 0,
    instruction: 'on_session_start',
    description: 'Fires after a ticket is paid and the session account exists.',
    accounts: ['kwami (readonly)', 'session (readonly)', 'player (readonly)', 'extension_state (mut)'],
  },
  {
    name: 'onWin',
    bit: 1 << 1,
    instruction: 'on_win',
    description: 'Fires after a payout has settled. Receives the amounts paid.',
    accounts: ['kwami (readonly)', 'session (readonly)', 'player (readonly)', 'extension_state (mut)'],
  },
  {
    name: 'onExpire',
    bit: 1 << 2,
    instruction: 'on_expire',
    description: 'Fires when a session is settled unwon.',
    accounts: ['kwami (readonly)', 'session (readonly)', 'extension_state (mut)'],
  },
  {
    name: 'onDeath',
    bit: 1 << 3,
    instruction: 'on_death',
    description: 'Fires once, when a Kwami crosses a death threshold.',
    accounts: ['kwami (readonly)', 'extension_state (mut)'],
  },
]

export function hooksToBitmask(names: string[]): number {
  return EXTENSION_HOOKS.filter((h) => names.includes(h.name)).reduce((mask, h) => mask | h.bit, 0)
}

export function bitmaskToHooks(mask: number): string[] {
  return EXTENSION_HOOKS.filter((h) => (mask & h.bit) !== 0).map((h) => h.name)
}

/** The scaffold every generated extension starts from. */
export const EXTENSION_TEMPLATE = `use anchor_lang::prelude::*;

declare_id!("REPLACE_WITH_YOUR_PROGRAM_ID");

/// State owned by this extension. The vault never reads or writes it.
#[account]
#[derive(InitSpace)]
pub struct ExtensionState {
    pub kwami: Pubkey,
    pub bump: u8,
    // Add your own fields here.
}

#[program]
pub mod kwami_extension {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.kwami = ctx.accounts.kwami.key();
        state.bump = ctx.bumps.state;
        Ok(())
    }

    /// Called by the vault after a ticket is paid.
    pub fn on_session_start(ctx: Context<OnSessionStart>) -> Result<()> {
        Ok(())
    }

    /// Called by the vault after a win settles.
    pub fn on_win(ctx: Context<OnWin>, payout_lamports: u64, payout_usdc: u64) -> Result<()> {
        Ok(())
    }

    /// Called by the vault when a session expires unwon.
    pub fn on_expire(ctx: Context<OnExpire>) -> Result<()> {
        Ok(())
    }

    /// Called once, when the Kwami dies.
    pub fn on_death(ctx: Context<OnDeath>) -> Result<()> {
        Ok(())
    }
}
`

/**
 * The rules a generated extension must satisfy.
 *
 * Written as a checklist rather than prose because it is fed to the model
 * verbatim *and* shown to the owner next to the generated code — the person
 * approving a deploy should be able to check the same list the generator was
 * given.
 */
export const EXTENSION_RULES = [
  'The extension may never hold authority over the Kwami vault PDA, request it as a signer, or attempt to move lamports out of it.',
  'Every arithmetic operation uses checked_* or saturating_* — an overflow in a financial game is a free withdrawal.',
  'All state lives in PDAs seeded by the Kwami mint, so two Kwamis running the same extension cannot collide.',
  'Hook instructions must be callable only by the Kwami vault program; verify the caller.',
  'A hook must never fail for a reason outside its own logic — a panic here reverts the whole settlement and traps the player’s payout.',
  'No unbounded loops, no unbounded Vec growth, no dynamic account allocation inside a hook.',
  'The program has no upgrade authority after deploy, or the immutability the Kwami advertises is a fiction.',
]
