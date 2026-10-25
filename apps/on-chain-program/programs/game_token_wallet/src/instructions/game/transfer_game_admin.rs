use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;

use super::close_game::ensure_caller_is_admin;
use crate::errors::ErrorCode;
use crate::state::{Game, User};

// Field names match `MintToPlayer` (`admin`, `user`, `player_user`, `game`,
// `player_ata`). Identical PDA seeds need identical field names so Codama
// keeps a single finder per account (`findUserPda`, `findPlayerUserPda`).
// `mint` and `token_program` are omitted: this instruction performs no token
// CPI, and `game.mint` is enough to derive the target ATA (design.md D2).
//
// `ensure_caller_is_admin` is the helper already defined in `close_game`.
// Both modules are glob-reexported from `instructions/game/mod.rs`, so a
// second copy here would make that name ambiguous.
#[derive(Accounts)]
#[instruction(game_id: [u8; 16], username: String, player_username: String)]
pub struct TransferGameAdmin<'info> {
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

    /// CHECK: the new admin's associated token account for `game.mint`.
    /// The handler checks the address against the ATA derivation and requires
    /// the account to already be initialized. `UncheckedAccount` so a missing
    /// ATA reports `PlayerNotInGame` instead of an Anchor deserialization
    /// error. Not `mut`: this instruction never writes token state.
    pub player_ata: UncheckedAccount<'info>,
}

pub fn ensure_not_self_admin(user: Pubkey, player_user: Pubkey) -> Result<()> {
    require_keys_neq!(user, player_user, ErrorCode::CannotTransferAdminToSelf);
    Ok(())
}

pub fn handler(
    ctx: Context<TransferGameAdmin>,
    _game_id: [u8; 16],
    _username: String,
    _player_username: String,
) -> Result<()> {
    ensure_caller_is_admin(ctx.accounts.user.key(), ctx.accounts.game.admin)?;
    ensure_not_self_admin(ctx.accounts.user.key(), ctx.accounts.player_user.key())?;

    let expected_ata =
        get_associated_token_address(&ctx.accounts.player_user.key(), &ctx.accounts.game.mint);
    require_keys_eq!(
        ctx.accounts.player_ata.key(),
        expected_ata,
        ErrorCode::InvalidPlayerAta
    );
    require!(
        !ctx.accounts.player_ata.data_is_empty(),
        ErrorCode::PlayerNotInGame
    );

    ctx.accounts.game.admin = ctx.accounts.player_user.key();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_transfer_to_a_different_player() {
        assert!(ensure_not_self_admin(Pubkey::new_unique(), Pubkey::new_unique()).is_ok());
    }

    #[test]
    fn rejects_transfer_to_self() {
        let admin_user = Pubkey::new_unique();
        assert!(ensure_not_self_admin(admin_user, admin_user).is_err());
    }

    #[test]
    fn cannot_transfer_admin_to_self_is_appended_without_renumbering() {
        // `#[error_code]` stores the variant index and adds
        // `ERROR_CODE_OFFSET` (6000) in `From<ErrorCode> for u32`. Inserting
        // this variant earlier would renumber GameNotEmpty (6013 / 0x177D)
        // and GameNotInRegistry (6014 / 0x177E).
        assert_eq!(u32::from(ErrorCode::NotGameAdmin), 6007);
        assert_eq!(u32::from(ErrorCode::GameNotEmpty), 6013);
        assert_eq!(u32::from(ErrorCode::GameNotInRegistry), 6014);
        assert_eq!(u32::from(ErrorCode::CannotTransferAdminToSelf), 6015);
    }
}
