use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{transfer, Mint, Token, Transfer};

use crate::errors::ErrorCode;
use crate::state::{Game, User};

// Named `sender`/`recipient` (not `user`/`player_user`, unlike
// `MintToPlayer`) because neither side here is "the caller's own identity
// checked against an on-chain fact" the way `mint_to_player`'s `user` is
// checked against `game.admin` — there is no on-chain "owner" fact for a P2P
// sender (see openspec/changes/general-mode-transfers/design.md decision 1
// and the architecture decision Q14 grill-me session). Both are still seeded
// identically to `User`'s seeds elsewhere (`[b"user", <username>,
// admin.key()]`), so Codama's IDL-driven client generator will not
// canonicalize them into the existing `user` finder — the same accepted
// trade-off `MintToPlayer`'s own `player_user` field already documents.
#[derive(Accounts)]
#[instruction(game_id: [u8; 16], sender_username: String, recipient_username: String, amount: u64)]
pub struct TransferToken<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"user", sender_username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub sender: Account<'info, User>,

    #[account(
        seeds = [b"user", recipient_username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub recipient: Account<'info, User>,

    #[account(seeds = [b"game", game_id.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    #[account(seeds = [b"mint", game.key().as_ref()], bump = game.mint_bump)]
    pub mint: Account<'info, Mint>,

    /// CHECK: the sender's own Associated Token Account for `mint`. Its
    /// address is validated against the deterministic ATA derivation for
    /// `(sender, mint)` in the handler. Unlike `recipient_ata` below, its
    /// initialized state isn't checked explicitly — it must already hold a
    /// balance for the CPI to succeed, so the SPL CPI's own rejection is the
    /// guarantee (see design.md decision 1's account table).
    #[account(mut)]
    pub sender_ata: UncheckedAccount<'info>,

    /// CHECK: the recipient's Associated Token Account for `mint`. Its
    /// address is validated against the deterministic ATA derivation for
    /// `(recipient, mint)` in the handler, and its initialized state is
    /// checked explicitly there too — transferring never auto-joins a
    /// player, mirroring `MintToPlayer`'s own `player_ata` validation.
    #[account(mut)]
    pub recipient_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn ensure_positive_amount(amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidTransferAmount);
    Ok(())
}

pub fn handler(
    ctx: Context<TransferToken>,
    _game_id: [u8; 16],
    sender_username: String,
    _recipient_username: String,
    amount: u64,
) -> Result<()> {
    require_keys_neq!(
        ctx.accounts.sender.key(),
        ctx.accounts.recipient.key(),
        ErrorCode::SelfTransfer
    );

    ensure_positive_amount(amount)?;

    let expected_sender_ata =
        get_associated_token_address(&ctx.accounts.sender.key(), &ctx.accounts.mint.key());
    require_keys_eq!(
        ctx.accounts.sender_ata.key(),
        expected_sender_ata,
        ErrorCode::InvalidPlayerAta
    );

    let expected_recipient_ata =
        get_associated_token_address(&ctx.accounts.recipient.key(), &ctx.accounts.mint.key());
    require_keys_eq!(
        ctx.accounts.recipient_ata.key(),
        expected_recipient_ata,
        ErrorCode::InvalidPlayerAta
    );
    require!(
        !ctx.accounts.recipient_ata.data_is_empty(),
        ErrorCode::PlayerNotInGame
    );

    // Authority is the sender's own `User` PDA (not `game`, unlike
    // `mint_to_player`'s mint-authority CPI) — this is what makes the
    // transfer spend from the specific player who initiated it rather than
    // relying on any admin privilege. See design.md decision 1.
    let admin_key = ctx.accounts.admin.key();
    let signer_seeds: &[&[u8]] = &[
        b"user",
        sender_username.as_bytes(),
        admin_key.as_ref(),
        &[ctx.bumps.sender],
    ];
    let cpi_accounts = Transfer {
        from: ctx.accounts.sender_ata.to_account_info(),
        to: ctx.accounts.recipient_ata.to_account_info(),
        authority: ctx.accounts.sender.to_account_info(),
    };
    let signer_seeds_arr = [signer_seeds];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        &signer_seeds_arr,
    );
    transfer(cpi_ctx, amount)?;

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
