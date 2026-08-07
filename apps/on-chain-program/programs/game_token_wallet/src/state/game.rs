use anchor_lang::prelude::*;

pub const MIN_GAME_NAME_BYTES: usize = 3;
pub const MAX_GAME_NAME_BYTES: usize = 32;
pub const GAME_ID_BYTES: usize = 16;
pub const MAX_PLAYERS_PER_GAME: usize = 20;

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum GameMode {
    General,
    Poker,
    Pool,
}

#[account]
#[derive(InitSpace)]
pub struct Game {
    pub bump: u8,
    pub mint_bump: u8,
    pub game_id: [u8; GAME_ID_BYTES],
    #[max_len(MAX_GAME_NAME_BYTES)]
    pub name: String,
    pub mode: GameMode,
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub player_count: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_init_space_accounts_for_all_fixed_and_bounded_fields() {
        // 1 (bump) + 1 (mint_bump) + GAME_ID_BYTES (game_id)
        // + (4 byte String length prefix + MAX_GAME_NAME_BYTES) (name)
        // + 1 (mode discriminant, fieldless enum) + 32 (admin) + 32 (mint)
        // + 1 (player_count).
        let expected = 1 + 1 + GAME_ID_BYTES + (4 + MAX_GAME_NAME_BYTES) + 1 + 32 + 32 + 1;
        assert_eq!(Game::INIT_SPACE, expected);
    }
}
