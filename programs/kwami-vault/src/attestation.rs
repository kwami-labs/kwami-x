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
const SIG_OFFSET_START: usize = 2;
const PUBKEY_OFFSET_START: usize = 6;
const MSG_OFFSET_START: usize = 10;
const MSG_SIZE_START: usize = 12;

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
    require!(now <= attestation.valid_until, KwamiError::AttestationExpired);

    let current = load_current_index_checked(ix_sysvar)?;
    require!(current > 0, KwamiError::BadAttestation);

    // The ed25519 instruction must sit immediately before this one, so an
    // attacker cannot bury a matching verification elsewhere in a large
    // transaction and have it counted twice.
    let ix = load_instruction_at_checked((current - 1) as usize, ix_sysvar)
        .map_err(|_| KwamiError::BadAttestation)?;

    require_keys_eq!(ix.program_id, ed25519_program::ID, KwamiError::BadAttestation);
    require!(ix.data.len() >= MSG_SIZE_START + 2, KwamiError::BadAttestation);

    // Exactly one signature, so there is no ambiguity about which one we checked.
    require!(ix.data[0] == 1, KwamiError::BadAttestation);

    let expected = attestation.message();
    let read_u16 = |at: usize| u16::from_le_bytes([ix.data[at], ix.data[at + 1]]) as usize;

    let sig_offset = read_u16(SIG_OFFSET_START);
    let pubkey_offset = read_u16(PUBKEY_OFFSET_START);
    let msg_offset = read_u16(MSG_OFFSET_START);
    let msg_size = read_u16(MSG_SIZE_START);

    require!(msg_size == expected.len(), KwamiError::AttestationMismatch);
    require!(sig_offset + 64 <= ix.data.len(), KwamiError::BadAttestation);
    require!(pubkey_offset + 32 <= ix.data.len(), KwamiError::BadAttestation);
    require!(msg_offset + msg_size <= ix.data.len(), KwamiError::BadAttestation);

    let signer = &ix.data[pubkey_offset..pubkey_offset + 32];
    require!(signer == oracle.as_ref(), KwamiError::BadAttestation);

    let message = &ix.data[msg_offset..msg_offset + msg_size];
    require!(message == expected.as_slice(), KwamiError::AttestationMismatch);

    Ok(())
}
