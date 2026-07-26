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
}
