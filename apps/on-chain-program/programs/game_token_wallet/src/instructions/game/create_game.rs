use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::errors::ErrorCode;
use crate::state::{
    Game, GameMode, Registry, User, MAX_ACTIVE_GAMES, MAX_GAME_NAME_BYTES, MIN_GAME_NAME_BYTES,
};

#[derive(Accounts)]
#[instruction(game_id: [u8; 16], name: String, username: String)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    // Named `user` (not `creator_user`) to match `create_user`'s own account
    // field of the same name: both instructions derive this PDA with
    // identical seeds (`[b"user", username, admin]`), and Codama's IDL-driven
    // client generator canonicalizes identically-seeded PDA accounts across
    // instructions into a single named finder — using a different field name
    // here would make it arbitrary (and, in one observed case, alphabetical
    // IDL instruction ordering picked `creator_user`, silently deleting the
    // `findUserPda`/`UserSeeds` exports that already-shipped frontend code
    // (`server/actions/auth.ts`) imports by name).
    #[account(
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    #[account(mut, seeds = [b"registry"], bump)]
    pub registry: Account<'info, Registry>,

    #[account(
        init,
        payer = admin,
        space = 8 + Game::INIT_SPACE,
        seeds = [b"game", game_id.as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,

    #[account(
        init,
        payer = admin,
        mint::decimals = 2,
        mint::authority = game,
        seeds = [b"mint", game.key().as_ref()],
        bump,
    )]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn ensure_registry_has_capacity(active_games_len: usize) -> Result<()> {
    require!(active_games_len < MAX_ACTIVE_GAMES, ErrorCode::RegistryFull);
    Ok(())
}

fn is_valid_game_name_char(c: char) -> bool {
    c.is_alphabetic() || c.is_numeric() || c == ' '
}

pub fn handler(
    ctx: Context<CreateGame>,
    game_id: [u8; 16],
    name: String,
    _username: String,
) -> Result<()> {
    let byte_len = name.as_bytes().len();
    require!(
        byte_len >= MIN_GAME_NAME_BYTES && byte_len <= MAX_GAME_NAME_BYTES,
        ErrorCode::InvalidGameNameLength
    );
    require!(
        name.chars().all(is_valid_game_name_char),
        ErrorCode::InvalidGameNameCharacters
    );
    ensure_registry_has_capacity(ctx.accounts.registry.active_games.len())?;

    let game = &mut ctx.accounts.game;
    game.bump = ctx.bumps.game;
    game.mint_bump = ctx.bumps.mint;
    game.game_id = game_id;
    game.name = name;
    game.mode = GameMode::General;
    game.admin = ctx.accounts.user.key();
    game.mint = ctx.accounts.mint.key();
    let game_key = game.key();

    ctx.accounts.registry.active_games.push(game_key);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_when_registry_has_room() {
        assert!(ensure_registry_has_capacity(MAX_ACTIVE_GAMES - 1).is_ok());
    }

    #[test]
    fn rejects_when_registry_is_at_capacity() {
        assert!(ensure_registry_has_capacity(MAX_ACTIVE_GAMES).is_err());
    }
}
