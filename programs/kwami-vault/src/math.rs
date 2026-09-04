use crate::errors::KwamiError;
use crate::state::{AUTHOR_ROYALTY_BPS_OF_FEE, BPS_DENOMINATOR};
use anchor_lang::prelude::*;

/// `amount * bps / 10_000`, rounding down, with no intermediate overflow.
///
/// Mirrors `applyBps` in `shared/game/economy.ts`. The two must agree exactly:
/// the UI quotes a payout from the TypeScript version and the program pays out
/// with this one, so a rounding difference would show up as a user-visible
/// "you were promised X, you got X-1".
pub fn apply_bps(amount: u64, bps: u16) -> Result<u64> {
    let out = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(KwamiError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(KwamiError::MathOverflow)?;
    u64::try_from(out).map_err(|_| KwamiError::MathOverflow.into())
}

pub struct TicketSplit {
    pub to_vault: u64,
    pub to_protocol: u64,
    pub to_author: u64,
}

/// Split a ticket into pot, treasury and author royalty.
///
/// The royalty is carved out of the protocol fee rather than charged on top,
/// so the challenger's total cost is exactly the advertised ticket price.
pub fn split_ticket(ticket: u64, fee_bps: u16) -> Result<TicketSplit> {
    let fee = apply_bps(ticket, fee_bps)?;
    let to_author = apply_bps(fee, AUTHOR_ROYALTY_BPS_OF_FEE)?;
    Ok(TicketSplit {
        to_vault: ticket.checked_sub(fee).ok_or(KwamiError::MathOverflow)?,
        to_protocol: fee.checked_sub(to_author).ok_or(KwamiError::MathOverflow)?,
        to_author,
    })
}

/// Death rule 1 — the vault has lost 99% of its high-water mark.
///
/// Expressed as `current * 100 < high_water_mark` to stay in integer math.
pub fn is_drawdown_dead(current_cents: u64, high_water_mark_cents: u64) -> bool {
    if high_water_mark_cents == 0 {
        return false;
    }
    (current_cents as u128) * 100 < high_water_mark_cents as u128
}

/// Death rule 2 — the vault is worth less than one dollar.
pub fn is_dust_dead(current_cents: u64) -> bool {
    current_cents < 100
}
