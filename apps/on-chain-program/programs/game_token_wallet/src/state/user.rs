use anchor_lang::prelude::*;

pub const MIN_USERNAME_BYTES: usize = 3;
pub const MAX_USERNAME_BYTES: usize = 32;
pub const SALT_BYTES: usize = 16;
pub const PASSWORD_HASH_BYTES: usize = 64;

#[account]
#[derive(InitSpace)]
pub struct User {
    pub bump: u8,
    #[max_len(MAX_USERNAME_BYTES)]
    pub username: String,
    pub salt: [u8; SALT_BYTES],
    pub password_hash: [u8; PASSWORD_HASH_BYTES],
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_init_space_accounts_for_max_username_salt_and_hash() {
        // 1 byte bump + (4 byte String length prefix + MAX_USERNAME_BYTES) + SALT_BYTES + PASSWORD_HASH_BYTES.
        let expected = 1 + (4 + MAX_USERNAME_BYTES) + SALT_BYTES + PASSWORD_HASH_BYTES;
        assert_eq!(User::INIT_SPACE, expected);
    }
}
