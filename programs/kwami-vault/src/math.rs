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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_bps_matches_the_advertised_eighty_percent() {
        assert_eq!(apply_bps(1_000, 8_000).unwrap(), 800);
        assert_eq!(apply_bps(1, 8_000).unwrap(), 0, "rounds down, never up");
        assert_eq!(apply_bps(0, 8_000).unwrap(), 0);
        assert_eq!(apply_bps(u64::MAX, 0).unwrap(), 0);
    }

    /// The payout is quoted by the TypeScript UI and paid by this program. A rounding
    /// disagreement shows up to a winner as "you were promised X and got X-1".
    #[test]
    fn apply_bps_rounds_down_like_the_typescript_side() {
        for amount in [1u64, 3, 7, 99, 101, 12_345, 999_999_999] {
            for bps in [1u16, 5_000, 8_000, 9_500, 10_000] {
                let expected = ((amount as u128) * (bps as u128) / 10_000) as u64;
                assert_eq!(
                    apply_bps(amount, bps).unwrap(),
                    expected,
                    "{amount} @ {bps}bps"
                );
            }
        }
    }

    #[test]
    fn apply_bps_survives_the_largest_possible_pot() {
        // u64::MAX * 10_000 overflows u64 but not the u128 the implementation widens to.
        assert_eq!(apply_bps(u64::MAX, 10_000).unwrap(), u64::MAX);
    }

    #[test]
    fn a_ticket_splits_without_losing_or_inventing_a_lamport() {
        for ticket in [1u64, 2, 999, 1_000, 1_000_000, 123_456_789] {
            for fee_bps in [0u16, 1, 250, 500, 1_000] {
                let split = split_ticket(ticket, fee_bps).unwrap();
                assert_eq!(
                    split.to_vault + split.to_protocol + split.to_author,
                    ticket,
                    "{ticket} @ {fee_bps}bps must be conserved"
                );
            }
        }
    }

    /// The royalty is carved out of the fee, not added to it, so the challenger pays exactly
    /// the advertised price.
    #[test]
    fn the_author_royalty_comes_out_of_the_protocol_fee() {
        let ticket = 1_000_000u64;
        let split = split_ticket(ticket, 500).unwrap();
        let fee = apply_bps(ticket, 500).unwrap();

        assert_eq!(split.to_vault, ticket - fee);
        assert_eq!(split.to_protocol + split.to_author, fee);
        assert!(
            split.to_author > 0,
            "the author must actually earn something"
        );
    }

    #[test]
    fn a_zero_fee_sends_the_whole_ticket_to_the_pot() {
        let split = split_ticket(500_000, 0).unwrap();
        assert_eq!(split.to_vault, 500_000);
        assert_eq!(split.to_protocol, 0);
        assert_eq!(split.to_author, 0);
    }

    #[test]
    fn drawdown_death_triggers_at_ninety_nine_percent_lost() {
        // Exactly 1% of the peak survives — alive, by the stated rule.
        assert!(!is_drawdown_dead(100, 10_000));
        // A hair under 1% — dead.
        assert!(is_drawdown_dead(99, 10_000));
        assert!(is_drawdown_dead(0, 10_000));
    }

    #[test]
    fn a_kwami_with_no_recorded_peak_cannot_die_of_drawdown() {
        // Otherwise a freshly minted Kwami would be born dead.
        assert!(!is_drawdown_dead(0, 0));
    }

    #[test]
    fn drawdown_death_does_not_overflow_on_a_huge_balance() {
        assert!(!is_drawdown_dead(u64::MAX, u64::MAX));
    }

    #[test]
    fn dust_death_is_the_one_dollar_floor() {
        assert!(is_dust_dead(0));
        assert!(is_dust_dead(99));
        assert!(!is_dust_dead(100), "exactly one dollar is alive");
        assert!(!is_dust_dead(101));
    }
}
