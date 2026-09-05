use crate::errors::KwamiError;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};

/// What the oracle signs to certify a win in `Attested` mode.
///
/// The message binds the session account, the player and a deadline, so a
/// captured attestation cannot be replayed against a different session, by a
/// different wallet, or after it goes stale.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct WinAttestation {
    pub session: Pubkey,
    pub player: Pubkey,
    /// Unix seconds after which this attestation is refused.
    pub valid_until: i64,
}

impl WinAttestation {
    pub fn message(&self) -> Vec<u8> {
        let mut msg = Vec::with_capacity(8 + 32 + 32 + 8);
        msg.extend_from_slice(b"KWAMIWIN");
        msg.extend_from_slice(self.session.as_ref());
        msg.extend_from_slice(self.player.as_ref());
        msg.extend_from_slice(&self.valid_until.to_le_bytes());
        msg
    }
}

/// Offsets inside an `Ed25519Program` instruction's data, per its ABI.
///
/// The header is `num_signatures: u8`, `padding: u8`, then a 14-byte
/// `Ed25519SignatureOffsets`:
///
/// ```text
///  0  num_signatures            u8
///  1  padding                   u8
///  2  signature_offset          u16
///  4  signature_instruction_index   u16
///  6  public_key_offset         u16
///  8  public_key_instruction_index  u16
/// 10  message_data_offset       u16
/// 12  message_data_size         u16
/// 14  message_instruction_index u16
/// 16  <data>
/// ```
const SIG_OFFSET_START: usize = 2;
const SIG_IX_INDEX_START: usize = 4;
const PUBKEY_OFFSET_START: usize = 6;
const PUBKEY_IX_INDEX_START: usize = 8;
const MSG_OFFSET_START: usize = 10;
const MSG_SIZE_START: usize = 12;
const MSG_IX_INDEX_START: usize = 14;
/// Where the signature/pubkey/message bytes begin, immediately after the offsets struct.
const DATA_START: usize = 16;

/// The index value meaning "read from this instruction's own data".
///
/// Each `*_instruction_index` field tells the runtime WHICH instruction to read that piece of
/// the signature from. `u16::MAX` means the ed25519 instruction itself, which is what
/// `Ed25519Program.createInstructionWithPublicKey` emits.
const SELF_INSTRUCTION_INDEX: u16 = u16::MAX;

/// Verify that the transaction contains a genuine ed25519 signature by
/// `oracle` over `attestation`.
///
/// Solana has no syscall to check an ed25519 signature inside a program. The
/// standard pattern is to have the client prepend a native `Ed25519Program`
/// instruction — the runtime verifies it, and the program then reads that
/// instruction back through the instructions sysvar to confirm *what* was
/// verified. Skipping that read-back is the classic hole: the runtime would
/// happily verify a signature over an attacker-chosen message.
pub fn verify_oracle_signature(
    ix_sysvar: &AccountInfo,
    oracle: &Pubkey,
    attestation: &WinAttestation,
    now: i64,
) -> Result<()> {
    require!(
        now <= attestation.valid_until,
        KwamiError::AttestationExpired
    );

    let current = load_current_index_checked(ix_sysvar)?;
    require!(current > 0, KwamiError::BadAttestation);

    // The ed25519 instruction must sit immediately before this one, so an
    // attacker cannot bury a matching verification elsewhere in a large
    // transaction and have it counted twice.
    let ix = load_instruction_at_checked((current - 1) as usize, ix_sysvar)
        .map_err(|_| KwamiError::BadAttestation)?;

    require_keys_eq!(
        ix.program_id,
        ed25519_program::ID,
        KwamiError::BadAttestation
    );

    assert_ed25519_covers(&ix.data, oracle, &attestation.message())
}

/// Check that an `Ed25519Program` instruction's data really is a signature by `oracle` over
/// `expected_message` — and, critically, that the bytes the runtime verified are the same bytes
/// we are reading.
///
/// Split out from `verify_oracle_signature` so it can be tested without a runtime: it is pure,
/// and it is where the whole security of `Attested` mode lives.
///
/// # The hole this closes
///
/// Each of the three `*_instruction_index` fields tells the runtime which instruction to take
/// that piece of the signature from. This code previously read `public_key_offset` and
/// `message_data_offset` out of the ed25519 instruction's own data and never looked at the
/// index fields at all — so an attacker could place the real oracle key and the expected
/// attestation bytes inside the ed25519 instruction (satisfying every check below), while
/// pointing the index fields at a *different* instruction holding their own key, their own
/// message and a signature that genuinely verifies. The runtime would verify that other
/// triple; this program would report that the oracle had signed the expected win. A forged
/// attestation, and 80% of a pot.
///
/// Requiring all three indices to be self-referential is what ties "what was verified" to
/// "what we read".
pub fn assert_ed25519_covers(data: &[u8], oracle: &Pubkey, expected_message: &[u8]) -> Result<()> {
    require!(data.len() >= DATA_START, KwamiError::BadAttestation);

    // Exactly one signature, so there is no ambiguity about which one we checked.
    require!(data[0] == 1, KwamiError::BadAttestation);

    let read_u16 = |at: usize| u16::from_le_bytes([data[at], data[at + 1]]);

    // Every piece must come from THIS instruction's data — see the doc comment above.
    require!(
        read_u16(SIG_IX_INDEX_START) == SELF_INSTRUCTION_INDEX,
        KwamiError::BadAttestation
    );
    require!(
        read_u16(PUBKEY_IX_INDEX_START) == SELF_INSTRUCTION_INDEX,
        KwamiError::BadAttestation
    );
    require!(
        read_u16(MSG_IX_INDEX_START) == SELF_INSTRUCTION_INDEX,
        KwamiError::BadAttestation
    );

    let sig_offset = read_u16(SIG_OFFSET_START) as usize;
    let pubkey_offset = read_u16(PUBKEY_OFFSET_START) as usize;
    let msg_offset = read_u16(MSG_OFFSET_START) as usize;
    let msg_size = read_u16(MSG_SIZE_START) as usize;

    require!(
        msg_size == expected_message.len(),
        KwamiError::AttestationMismatch
    );

    // Checked arithmetic: a hostile offset near u16::MAX must not wrap past the length test.
    let sig_end = sig_offset
        .checked_add(64)
        .ok_or(KwamiError::BadAttestation)?;
    let pubkey_end = pubkey_offset
        .checked_add(32)
        .ok_or(KwamiError::BadAttestation)?;
    let msg_end = msg_offset
        .checked_add(msg_size)
        .ok_or(KwamiError::BadAttestation)?;
    require!(sig_end <= data.len(), KwamiError::BadAttestation);
    require!(pubkey_end <= data.len(), KwamiError::BadAttestation);
    require!(msg_end <= data.len(), KwamiError::BadAttestation);

    // None of the three may reach back into the header, or an attacker could point them at
    // the offsets struct itself and have it double as signed material.
    require!(sig_offset >= DATA_START, KwamiError::BadAttestation);
    require!(pubkey_offset >= DATA_START, KwamiError::BadAttestation);
    require!(msg_offset >= DATA_START, KwamiError::BadAttestation);

    require!(
        &data[pubkey_offset..pubkey_end] == oracle.as_ref(),
        KwamiError::BadAttestation
    );
    require!(
        &data[msg_offset..msg_end] == expected_message,
        KwamiError::AttestationMismatch
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIG_LEN: usize = 64;
    const PUBKEY_LEN: usize = 32;

    /// Build ed25519 instruction data the way `Ed25519Program.createInstructionWithPublicKey`
    /// does: header, then public key, then signature, then message, with every
    /// `*_instruction_index` self-referential.
    ///
    /// The `*_ix_index` parameters exist so a test can point one piece at another instruction —
    /// which is exactly the forgery this module has to refuse.
    struct Ed25519Data {
        pubkey: [u8; PUBKEY_LEN],
        message: Vec<u8>,
        num_signatures: u8,
        sig_ix_index: u16,
        pubkey_ix_index: u16,
        msg_ix_index: u16,
    }

    impl Ed25519Data {
        fn new(pubkey: [u8; PUBKEY_LEN], message: &[u8]) -> Self {
            Self {
                pubkey,
                message: message.to_vec(),
                num_signatures: 1,
                sig_ix_index: SELF_INSTRUCTION_INDEX,
                pubkey_ix_index: SELF_INSTRUCTION_INDEX,
                msg_ix_index: SELF_INSTRUCTION_INDEX,
            }
        }

        fn build(&self) -> Vec<u8> {
            let pubkey_offset = DATA_START as u16;
            let sig_offset = pubkey_offset + PUBKEY_LEN as u16;
            let msg_offset = sig_offset + SIG_LEN as u16;

            let mut data =
                Vec::with_capacity(DATA_START + PUBKEY_LEN + SIG_LEN + self.message.len());
            data.push(self.num_signatures);
            data.push(0); // padding
            data.extend_from_slice(&sig_offset.to_le_bytes());
            data.extend_from_slice(&self.sig_ix_index.to_le_bytes());
            data.extend_from_slice(&pubkey_offset.to_le_bytes());
            data.extend_from_slice(&self.pubkey_ix_index.to_le_bytes());
            data.extend_from_slice(&msg_offset.to_le_bytes());
            data.extend_from_slice(&(self.message.len() as u16).to_le_bytes());
            data.extend_from_slice(&self.msg_ix_index.to_le_bytes());
            assert_eq!(
                data.len(),
                DATA_START,
                "header must be exactly DATA_START bytes"
            );

            data.extend_from_slice(&self.pubkey);
            data.extend_from_slice(&[7u8; SIG_LEN]); // the runtime checks the signature, not us
            data.extend_from_slice(&self.message);
            data
        }
    }

    fn oracle() -> Pubkey {
        Pubkey::new_from_array([3u8; PUBKEY_LEN])
    }

    fn attestation() -> WinAttestation {
        WinAttestation {
            session: Pubkey::new_from_array([1u8; PUBKEY_LEN]),
            player: Pubkey::new_from_array([2u8; PUBKEY_LEN]),
            valid_until: 1_800_000_000,
        }
    }

    #[test]
    fn accepts_a_well_formed_self_referential_instruction() {
        let msg = attestation().message();
        let data = Ed25519Data::new(oracle().to_bytes(), &msg).build();

        assert!(assert_ed25519_covers(&data, &oracle(), &msg).is_ok());
    }

    #[test]
    fn message_binds_the_session_the_player_and_the_deadline() {
        let msg = attestation().message();

        assert_eq!(&msg[..8], b"KWAMIWIN");
        assert_eq!(msg.len(), 8 + 32 + 32 + 8);

        let mut other = attestation();
        other.player = Pubkey::new_from_array([9u8; PUBKEY_LEN]);
        assert_ne!(
            other.message(),
            msg,
            "a different player must not share a message"
        );

        let mut later = attestation();
        later.valid_until += 1;
        assert_ne!(
            later.message(),
            msg,
            "a different deadline must not share a message"
        );
    }

    /// The forgery the index fields exist to stop.
    ///
    /// The attacker puts the REAL oracle key and the REAL expected message inside the ed25519
    /// instruction — so every offset check passes — but points an index field at another
    /// instruction carrying their own key, message and a signature that genuinely verifies.
    /// The runtime verifies that other triple; without this check the program would conclude
    /// the oracle had signed the win.
    #[test]
    fn rejects_a_message_sourced_from_another_instruction() {
        let msg = attestation().message();
        let mut spec = Ed25519Data::new(oracle().to_bytes(), &msg);
        spec.msg_ix_index = 0;

        assert!(assert_ed25519_covers(&spec.build(), &oracle(), &msg).is_err());
    }

    #[test]
    fn rejects_a_public_key_sourced_from_another_instruction() {
        let msg = attestation().message();
        let mut spec = Ed25519Data::new(oracle().to_bytes(), &msg);
        spec.pubkey_ix_index = 0;

        assert!(assert_ed25519_covers(&spec.build(), &oracle(), &msg).is_err());
    }

    #[test]
    fn rejects_a_signature_sourced_from_another_instruction() {
        let msg = attestation().message();
        let mut spec = Ed25519Data::new(oracle().to_bytes(), &msg);
        spec.sig_ix_index = 0;

        assert!(assert_ed25519_covers(&spec.build(), &oracle(), &msg).is_err());
    }

    #[test]
    fn rejects_a_signature_by_anyone_but_the_oracle() {
        let msg = attestation().message();
        let data = Ed25519Data::new([8u8; PUBKEY_LEN], &msg).build();

        assert!(assert_ed25519_covers(&data, &oracle(), &msg).is_err());
    }

    #[test]
    fn rejects_a_signature_over_a_different_message() {
        let msg = attestation().message();
        let mut other = attestation();
        other.session = Pubkey::new_from_array([9u8; PUBKEY_LEN]);
        let data = Ed25519Data::new(oracle().to_bytes(), &other.message()).build();

        assert!(assert_ed25519_covers(&data, &oracle(), &msg).is_err());
    }

    #[test]
    fn rejects_more_or_fewer_than_one_signature() {
        let msg = attestation().message();

        for count in [0u8, 2, 255] {
            let mut spec = Ed25519Data::new(oracle().to_bytes(), &msg);
            spec.num_signatures = count;
            assert!(
                assert_ed25519_covers(&spec.build(), &oracle(), &msg).is_err(),
                "num_signatures = {count} must be refused"
            );
        }
    }

    #[test]
    fn rejects_data_too_short_to_hold_the_offsets() {
        let msg = attestation().message();
        let full = Ed25519Data::new(oracle().to_bytes(), &msg).build();

        for len in 0..DATA_START {
            assert!(
                assert_ed25519_covers(&full[..len], &oracle(), &msg).is_err(),
                "{len} bytes must be refused"
            );
        }
    }

    #[test]
    fn rejects_offsets_that_run_past_the_end() {
        let msg = attestation().message();
        let mut data = Ed25519Data::new(oracle().to_bytes(), &msg).build();
        // Push the message offset beyond the buffer.
        data[MSG_OFFSET_START..MSG_OFFSET_START + 2].copy_from_slice(&u16::MAX.to_le_bytes());

        assert!(assert_ed25519_covers(&data, &oracle(), &msg).is_err());
    }

    /// A near-`u16::MAX` offset must fail the bounds test rather than wrap through it.
    #[test]
    fn rejects_offsets_that_would_overflow_on_addition() {
        let msg = attestation().message();
        let mut data = Ed25519Data::new(oracle().to_bytes(), &msg).build();
        data[PUBKEY_OFFSET_START..PUBKEY_OFFSET_START + 2]
            .copy_from_slice(&(u16::MAX - 1).to_le_bytes());

        assert!(assert_ed25519_covers(&data, &oracle(), &msg).is_err());
    }

    /// Pointing a field back into the header would let the offsets struct double as signed
    /// material, which is not something an honest client ever does.
    #[test]
    fn rejects_offsets_that_reach_into_the_header() {
        let msg = attestation().message();
        let mut data = Ed25519Data::new(oracle().to_bytes(), &msg).build();
        data[MSG_OFFSET_START..MSG_OFFSET_START + 2].copy_from_slice(&0u16.to_le_bytes());

        assert!(assert_ed25519_covers(&data, &oracle(), &msg).is_err());
    }

    #[test]
    fn rejects_a_message_size_that_disagrees_with_the_attestation() {
        let msg = attestation().message();
        let mut data = Ed25519Data::new(oracle().to_bytes(), &msg).build();
        let wrong = (msg.len() as u16) - 1;
        data[MSG_SIZE_START..MSG_SIZE_START + 2].copy_from_slice(&wrong.to_le_bytes());

        assert!(assert_ed25519_covers(&data, &oracle(), &msg).is_err());
    }
}
