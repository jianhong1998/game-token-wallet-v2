use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::state::{Game, Registry, User};

#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String)]
pub struct CloseGame<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    // `close = admin`: Anchor's declarative close constraint reclaims this
    // account's rent to `admin` once the handler returns successfully — no
    // manual CPI needed (there is no CPI to make; a `Game` account is owned
    // by this program itself, not the Token program).
    #[account(mut, seeds = [b"game", game_id.as_ref()], bump = game.bump, close = admin)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [b"registry"], bump)]
    pub registry: Account<'info, Registry>,
}

pub fn ensure_caller_is_admin(user: Pubkey, game_admin: Pubkey) -> Result<()> {
    require_keys_eq!(user, game_admin, ErrorCode::NotGameAdmin);
    Ok(())
}

pub fn ensure_game_is_empty(player_count: u8) -> Result<()> {
    require_eq!(player_count, 0, ErrorCode::GameNotEmpty);
    Ok(())
}

pub fn find_registry_index(active_games: &[Pubkey], game: Pubkey) -> Result<usize> {
    active_games
        .iter()
        .position(|candidate| *candidate == game)
        .ok_or_else(|| error!(ErrorCode::GameNotInRegistry))
}

// NOTE: this instruction never touches `game.mint`. The legacy SPL Token
// program has no instruction capable of closing/reclaiming rent from a
// `Mint` account (only Token-2022's `MintCloseAuthority` extension supports
// that, which this project's mints don't use) — see design.md D3's
// correction note. Do not add a mint-closing CPI here.
pub fn handler(ctx: Context<CloseGame>, _game_id: [u8; 16], _username: String) -> Result<()> {
    ensure_caller_is_admin(ctx.accounts.user.key(), ctx.accounts.game.admin)?;
    ensure_game_is_empty(ctx.accounts.game.player_count)?;

    let game_key = ctx.accounts.game.key();
    let index = find_registry_index(&ctx.accounts.registry.active_games, game_key)?;
    ctx.accounts.registry.active_games.swap_remove(index);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_games_admin() {
        let admin_user = Pubkey::new_unique();
        assert!(ensure_caller_is_admin(admin_user, admin_user).is_ok());
    }

    #[test]
    fn rejects_a_non_admin_caller() {
        assert!(ensure_caller_is_admin(Pubkey::new_unique(), Pubkey::new_unique()).is_err());
    }

    #[test]
    fn allows_an_empty_game() {
        assert!(ensure_game_is_empty(0).is_ok());
    }

    #[test]
    fn rejects_a_non_empty_game() {
        assert!(ensure_game_is_empty(1).is_err());
    }

    #[test]
    fn finds_the_games_index_in_the_registry() {
        let game = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let active_games = vec![other, game];
        assert_eq!(find_registry_index(&active_games, game).unwrap(), 1);
    }

    #[test]
    fn errors_when_the_game_is_not_in_the_registry() {
        let game = Pubkey::new_unique();
        let active_games = vec![Pubkey::new_unique()];
        assert!(find_registry_index(&active_games, game).is_err());
    }
}
