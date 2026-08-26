use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{burn, close_account, Burn, CloseAccount, Mint, Token, TokenAccount};

use crate::errors::ErrorCode;
use crate::state::{Game, User};

// `user` = the calling game admin's own identity; `player_user` = the
// target player being closed out (may be the same username as `user` when
// the admin is closing their own player slot — see design.md D2). Both PDAs
// are derived from the SAME `admin` signer (seeds
// `[b"user", <username>, admin.key()]` each), matching `mint_to_player.rs`'s
// existing two-user pattern and its Codama field-naming convention.
#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String, player_username: String)]
pub struct CloseGamePlayer<'info> {
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

    #[account(mut, seeds = [b"game", game_id.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    // `mut`: the `Burn` CPI below reduces total supply, requiring the mint
    // to be writable (same reasoning as `quit_game.rs`'s own `mint` field).
    #[account(mut, seeds = [b"mint", game.key().as_ref()], bump = game.mint_bump)]
    pub mint: Account<'info, Mint>,

    /// CHECK: the target player's Associated Token Account for `mint`. Its
    /// address is validated against the deterministic ATA derivation for
    /// `(player_user, mint)` in the handler, and its initialized state is
    /// checked explicitly there too — same posture as `quit_game.rs`'s own
    /// `player_ata` check.
    #[account(mut)]
    pub player_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn ensure_caller_is_admin(user: Pubkey, game_admin: Pubkey) -> Result<()> {
    require_keys_eq!(user, game_admin, ErrorCode::NotGameAdmin);
    Ok(())
}

pub fn handler(
    ctx: Context<CloseGamePlayer>,
    _game_id: [u8; 16],
    _username: String,
    player_username: String,
) -> Result<()> {
    ensure_caller_is_admin(ctx.accounts.user.key(), ctx.accounts.game.admin)?;

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

    // Burn whatever the ATA actually holds — never a client-supplied
    // amount, same as `quit_game.rs`.
    let balance = {
        let data = ctx.accounts.player_ata.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut &data[..])?.amount
    };

    // Authority is always the TARGET's own `User` PDA (`player_user`), not
    // the caller's — this is what makes the burn valid regardless of which
    // player is targeted, including the admin's own slot (where
    // `player_username == username` and `player_user` resolves to the same
    // PDA as `user`, with no special-casing needed).
    let admin_key = ctx.accounts.admin.key();
    let signer_seeds: &[&[u8]] = &[
        b"user",
        player_username.as_bytes(),
        admin_key.as_ref(),
        &[ctx.bumps.player_user],
    ];
    let signer_seeds_arr = [signer_seeds];

    let burn_accounts = Burn {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.player_ata.to_account_info(),
        authority: ctx.accounts.player_user.to_account_info(),
    };
    let burn_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        burn_accounts,
        &signer_seeds_arr,
    );
    burn(burn_ctx, balance)?;

    let close_accounts = CloseAccount {
        account: ctx.accounts.player_ata.to_account_info(),
        destination: ctx.accounts.admin.to_account_info(),
        authority: ctx.accounts.player_user.to_account_info(),
    };
    let close_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        close_accounts,
        &signer_seeds_arr,
    );
    close_account(close_ctx)?;

    ctx.accounts.game.player_count -= 1;

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
        let caller = Pubkey::new_unique();
        let game_admin = Pubkey::new_unique();
        assert!(ensure_caller_is_admin(caller, game_admin).is_err());
    }
}
