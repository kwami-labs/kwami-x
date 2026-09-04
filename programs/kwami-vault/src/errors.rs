use anchor_lang::prelude::*;

#[error_code]
pub enum KwamiError {
    #[msg("Protocol is paused.")]
    ProtocolPaused,
    #[msg("This Kwami is not accepting challengers.")]
    NotLive,
    #[msg("This Kwami is dead.")]
    KwamiDead,
    #[msg("This Kwami's secret has been revealed; it can no longer be played.")]
    KwamiCracked,
    #[msg("Only the current owner may do that.")]
    NotOwner,
    #[msg("Payout share must be between 50% and 95%.")]
    PayoutOutOfRange,
    #[msg("Session duration must be between 30 and 900 seconds.")]
    DurationOutOfRange,
    #[msg("Protocol fee exceeds the hard cap.")]
    FeeTooHigh,
    #[msg("At least one ticket price must be non-zero.")]
    NoTicketPrice,
    #[msg("This Kwami does not accept tickets in that asset.")]
    AssetNotAccepted,
    #[msg("Session has already been resolved.")]
    SessionResolved,
    #[msg("Session has expired.")]
    SessionExpired,
    #[msg("Session is still running; wait for it to expire.")]
    SessionActive,
    #[msg("The submitted pre-image does not hash to this Kwami's secret.")]
    WrongSecret,
    #[msg("Pre-image is longer than the 256-byte limit.")]
    PreimageTooLong,
    #[msg("Missing or malformed ed25519 oracle signature.")]
    BadAttestation,
    #[msg("Attestation does not cover this session.")]
    AttestationMismatch,
    #[msg("Attestation has expired.")]
    AttestationExpired,
    #[msg("Wrong resolution mode for this instruction.")]
    WrongResolutionMode,
    #[msg("An extension is already registered for this Kwami.")]
    ExtensionAlreadyRegistered,
    #[msg("Extensions can only be attached before the Kwami first goes live.")]
    ExtensionLocked,
    #[msg("Withdrawals are only allowed while unpublished or after death.")]
    WithdrawNotAllowed,
    #[msg("Vault holds less than the requested amount.")]
    InsufficientVault,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("The signer does not hold this Kwami's NFT.")]
    NotNftHolder,
    #[msg("Price feed is stale or invalid.")]
    StalePrice,
}
