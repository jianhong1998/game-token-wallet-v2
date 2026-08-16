use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{burn, close_account, Burn, CloseAccount, Mint, Token, TokenAccount};

use crate::errors::ErrorCode;
use crate::state::{Game, User};

// Named `user` (not `player_user`), matching `JoinGame`'s own field for the
// same reason documented there: identical PDA seeds across instructions need
// identical field names for Codama's IDL-driven client generator to
// canonicalize them into a single named finder. There is no separate
// "target player" field the way `MintToPlayer` has `player_user` vs `user`
// — quitting is self-service, so the caller IS the target (see
// openspec/changes/quit-game/design.md decision D1).
#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String)]
pub struct QuitGame<'info> {
    // `mut`: this account is both the transaction fee-payer and the
    // destination for the closed ATA's reclaimed rent (design.md D5).
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    #[account(mut, seeds = [b"game", game_id.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    // `mut`: the `Burn` CPI below reduces total supply, which requires the
    // mint account to be writable (unlike `TransferToken`'s `mint`, which is
    // read-only since a plain transfer never touches supply).
    #[account(mut, seeds = [b"mint", game.key().as_ref()], bump = game.mint_bump)]
    pub mint: Account<'info, Mint>,

    /// CHECK: this is the quitting player's own Associated Token Account for
    /// `mint`. Its address is validated against the deterministic ATA
    /// derivation for `(user, mint)` in the handler, and its initialized
    /// state is checked explicitly there too — mirroring `JoinGame`'s own
    /// `player_ata` validation approach. Kept as `UncheckedAccount` (not a
    /// typed `Account<'info, TokenAccount>`) so an uninitialized ATA reports
    /// the custom `PlayerNotInGame` error instead of a generic Anchor
    /// deserialization failure; the handler manually deserializes it once
    /// it's confirmed non-empty, to read the actual balance to burn.
    #[account(mut)]
    pub player_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn ensure_not_admin(user: Pubkey, game_admin: Pubkey) -> Result<()> {
    require_keys_neq!(user, game_admin, ErrorCode::AdminCannotQuitGame);
    Ok(())
}

pub fn handler(ctx: Context<QuitGame>, _game_id: [u8; 16], username: String) -> Result<()> {
    let expected_ata =
        get_associated_token_address(&ctx.accounts.user.key(), &ctx.accounts.mint.key());
    require_keys_eq!(
        ctx.accounts.player_ata.key(),
        expected_ata,
        ErrorCode::InvalidPlayerAta
    );
    require!(
        !ctx.accounts.player_ata.data_is_empty(),
        ErrorCode::PlayerNotInGame
    );

    ensure_not_admin(ctx.accounts.user.key(), ctx.accounts.game.admin)?;

    // Burn whatever the ATA actually holds — never a client-supplied
    // amount (design.md D4). `player_ata` is `UncheckedAccount`, so the
    // balance is read by manually deserializing the raw SPL token-account
    // layout rather than via Anchor's typed-account auto-deserialization.
    let balance = {
        let data = ctx.accounts.player_ata.try_borrow_data()?;
        TokenAccount::try_deserialize(&mut &data[..])?.amount
    };

    // Authority is the quitting player's own `User` PDA (not `game` or
    // `admin`), matching `TransferToken`'s self-authorized signer pattern —
    // this is what makes the action self-service rather than
    // admin-privileged (design.md D1).
    let admin_key = ctx.accounts.admin.key();
    let signer_seeds: &[&[u8]] = &[
        b"user",
        username.as_bytes(),
        admin_key.as_ref(),
        &[ctx.bumps.user],
    ];
    let signer_seeds_arr = [signer_seeds];

    let burn_accounts = Burn {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.player_ata.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let burn_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        burn_accounts,
        &signer_seeds_arr,
    );
    burn(burn_ctx, balance)?;

    // Rent destination is `admin` (the system signer) — mirrors who paid
    // the ATA's rent at `join_game` time (design.md D5).
    let close_accounts = CloseAccount {
        account: ctx.accounts.player_ata.to_account_info(),
        destination: ctx.accounts.admin.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let close_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        close_accounts,
        &signer_seeds_arr,
    );
    close_account(close_ctx)?;

    // Plain decrement, no `checked_sub` needed: only a caller whose ATA
    // already exists (proven by the `PlayerNotInGame` check above) reaches
    // this line, and the one player who could otherwise complicate
    // accounting — the admin — is rejected above. Concurrent
    // quit/join requests against this same `Game` account are serialized
    // for free by Solana's runtime account-level write-locking (design.md
    // D3) — no CAS or extra lock needed.
    ctx.accounts.game.player_count -= 1;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_a_non_admin_player() {
        let user = Pubkey::new_unique();
        let admin = Pubkey::new_unique();
        assert!(ensure_not_admin(user, admin).is_ok());
    }

    #[test]
    fn rejects_the_admin() {
        let admin = Pubkey::new_unique();
        assert!(ensure_not_admin(admin, admin).is_err());
    }
}
