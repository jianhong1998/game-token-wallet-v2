use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self, get_associated_token_address, AssociatedToken, Create};
use anchor_spl::token::{Mint, Token};

use crate::errors::ErrorCode;
use crate::state::{Game, User, MAX_PLAYERS_PER_GAME};

// Named `user` (not `player_user`) to match `create_game`'s own `user` account
// field of the same name: both instructions derive this PDA with identical
// seeds (`[b"user", username, admin]`), and Codama's IDL-driven client
// generator canonicalizes identically-seeded PDA accounts across
// instructions into a single named finder — a different field name here
// would make that name arbitrary (see `create_game.rs`'s own comment on
// this same issue).
#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    #[account(mut, seeds = [b"game", game_id.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    #[account(seeds = [b"mint", game.key().as_ref()], bump = game.mint_bump)]
    pub mint: Account<'info, Mint>,

    /// CHECK: this is the joining player's Associated Token Account for
    /// `mint`. Its address is validated against the deterministic ATA
    /// derivation for `(user, mint)` in the handler, and its
    /// not-yet-initialized state is checked explicitly there too — not via
    /// a declarative `init` constraint, so a duplicate join returns the
    /// custom `AlreadyJoinedGame` error instead of a generic
    /// account-already-in-use failure from the CPI below.
    #[account(mut)]
    pub player_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn ensure_game_has_capacity(player_count: u8) -> Result<()> {
    require!(
        (player_count as usize) < MAX_PLAYERS_PER_GAME,
        ErrorCode::GameFull
    );
    Ok(())
}

pub fn handler(ctx: Context<JoinGame>, _game_id: [u8; 16], _username: String) -> Result<()> {
    let expected_ata =
        get_associated_token_address(&ctx.accounts.user.key(), &ctx.accounts.mint.key());
    require_keys_eq!(
        ctx.accounts.player_ata.key(),
        expected_ata,
        ErrorCode::InvalidPlayerAta
    );

    ensure_game_has_capacity(ctx.accounts.game.player_count)?;

    require!(
        ctx.accounts.player_ata.data_is_empty(),
        ErrorCode::AlreadyJoinedGame
    );

    let cpi_accounts = Create {
        payer: ctx.accounts.admin.to_account_info(),
        associated_token: ctx.accounts.player_ata.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };
    // This repo's resolved anchor-lang/anchor-spl (1.1.2) uses a
    // `CpiContext::new(program_id: Pubkey, accounts: T)` signature, not the
    // `AccountInfo`-taking one the plan snippet assumed — pass `.key()`
    // instead of `.to_account_info()` to match.
    let cpi_ctx = CpiContext::new(ctx.accounts.associated_token_program.key(), cpi_accounts);
    associated_token::create(cpi_ctx)?;

    ctx.accounts.game.player_count += 1;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_when_game_has_room() {
        assert!(ensure_game_has_capacity((MAX_PLAYERS_PER_GAME - 1) as u8).is_ok());
    }

    #[test]
    fn rejects_when_game_is_at_capacity() {
        assert!(ensure_game_has_capacity(MAX_PLAYERS_PER_GAME as u8).is_err());
    }
}
