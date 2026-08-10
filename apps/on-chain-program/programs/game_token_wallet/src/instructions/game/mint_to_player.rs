use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{mint_to, Mint, MintTo, Token};

use crate::errors::ErrorCode;
use crate::state::{Game, User};

// Named `user` (not `admin_user`) and `admin` (the system wallet, not the
// game's admin) for the same reasons documented on `JoinGame`/`CreateGame`'s
// own `user`/`admin` fields: identical PDA seeds across instructions need
// identical field names for Codama's IDL-driven client generator to
// canonicalize them into a single named finder. The *target* player's own
// `User` PDA can't reuse the `user` name (Anchor forbids duplicate accessor
// names in one `Accounts` struct), so it's `player_user` instead, following
// the same `player_`-prefix convention `JoinGame` already uses for
// `player_ata`.
#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String, player_username: String, amount: u64)]
pub struct MintToPlayer<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    #[account(
        seeds = [b"user", player_username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub player_user: Account<'info, User>,

    #[account(seeds = [b"game", game_id.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [b"mint", game.key().as_ref()], bump = game.mint_bump)]
    pub mint: Account<'info, Mint>,

    /// CHECK: this is the target player's Associated Token Account for
    /// `mint`. Its address is validated against the deterministic ATA
    /// derivation for `(player_user, mint)` in the handler, and its
    /// initialized state is checked explicitly there too — it must already
    /// exist, since depositing never auto-joins a player — mirroring
    /// `JoinGame`'s own `player_ata` validation approach.
    #[account(mut)]
    pub player_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn ensure_positive_amount(amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidDepositAmount);
    Ok(())
}

pub fn handler(
    ctx: Context<MintToPlayer>,
    game_id: [u8; 16],
    _username: String,
    _player_username: String,
    amount: u64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.user.key(),
        ctx.accounts.game.admin,
        ErrorCode::NotGameAdmin
    );

    ensure_positive_amount(amount)?;

    let expected_ata =
        get_associated_token_address(&ctx.accounts.player_user.key(), &ctx.accounts.mint.key());
    require_keys_eq!(
        ctx.accounts.player_ata.key(),
        expected_ata,
        ErrorCode::InvalidPlayerAta
    );
    require!(
        !ctx.accounts.player_ata.data_is_empty(),
        ErrorCode::PlayerNotInGame
    );

    let signer_seeds: &[&[u8]] = &[b"game", game_id.as_ref(), &[ctx.accounts.game.bump]];
    let cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.player_ata.to_account_info(),
        authority: ctx.accounts.game.to_account_info(),
    };
    // This repo's resolved anchor-lang/anchor-spl (1.1.2) uses a
    // `CpiContext::new_with_signer(program_id: Pubkey, accounts: T, signer_seeds)`
    // signature — pass `.key()`, not `.to_account_info()`, matching the same
    // convention `JoinGame`'s own CPI already documents.
    let signer_seeds_arr = [signer_seeds];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        &signer_seeds_arr,
    );
    mint_to(cpi_ctx, amount)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_a_positive_amount() {
        assert!(ensure_positive_amount(1).is_ok());
    }

    #[test]
    fn rejects_a_zero_amount() {
        assert!(ensure_positive_amount(0).is_err());
    }
}
