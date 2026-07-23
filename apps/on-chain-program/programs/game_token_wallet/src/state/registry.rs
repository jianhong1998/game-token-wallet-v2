use anchor_lang::prelude::*;

/// Bound chosen for a self-hosted, friend-group deployment (see
/// docs/superpowers/specs/2026-07-23-registry-account-init-design.md, Q2) —
/// generous headroom while keeping the singleton account small and cheap.
/// This is a one-time size decision: the account is never resized after init.
pub const MAX_ACTIVE_GAMES: usize = 128;

#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub bump: u8,
    #[max_len(MAX_ACTIVE_GAMES)]
    pub active_games: Vec<Pubkey>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_init_space_accounts_for_max_active_games_pubkeys() {
        // 1 byte bump + 4 byte Vec length prefix + MAX_ACTIVE_GAMES * 32-byte Pubkey.
        let expected = 1 + 4 + MAX_ACTIVE_GAMES * 32;
        assert_eq!(Registry::INIT_SPACE, expected);
    }
}
