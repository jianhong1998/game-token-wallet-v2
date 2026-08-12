use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Username must be between 3 and 32 bytes")]
    InvalidUsernameLength,
    #[msg("Game name must be between 3 and 32 bytes")]
    InvalidGameNameLength,
    #[msg("Game name can only contain letters, numbers, and spaces")]
    InvalidGameNameCharacters,
    #[msg("Registry is full")]
    RegistryFull,
    #[msg("Game already has the maximum of 20 players")]
    GameFull,
    #[msg("You are already a player in this game")]
    AlreadyJoinedGame,
    #[msg("Player token account address does not match the expected associated token account")]
    InvalidPlayerAta,
    #[msg("Only the game's admin can perform this action")]
    NotGameAdmin,
    #[msg("Target user has not joined this game")]
    PlayerNotInGame,
    #[msg("Deposit amount must be greater than zero")]
    InvalidDepositAmount,
    #[msg("Cannot transfer tokens to yourself")]
    SelfTransfer,
    #[msg("Transfer amount must be greater than zero")]
    InvalidTransferAmount,
}
