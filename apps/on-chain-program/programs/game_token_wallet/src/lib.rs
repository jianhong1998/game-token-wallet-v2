use anchor_lang::prelude::*;

mod errors;
mod instructions;
mod state;

// Wildcard import (not just `InitializeRegistry`) is required: the
// `#[derive(Accounts)]` macro also generates a hidden `__client_accounts_*`
// module that `#[program]`'s expansion looks up at the crate root — a named
// import wouldn't bring that hidden module into scope.
use instructions::*;

declare_id!("FHRNx4KK4WzMxXx7X6sK84RvKTKuDVtTGduW3eH9QN9t");

#[program]
pub mod game_token_wallet {
    use super::*;

    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        instructions::registry::initialize::handler(ctx)
    }

    pub fn create_user(
        ctx: Context<CreateUser>,
        username: String,
        salt: [u8; 16],
        password_hash: [u8; 64],
    ) -> Result<()> {
        instructions::user::create_user::handler(ctx, username, salt, password_hash)
    }

    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: [u8; 16],
        name: String,
        username: String,
    ) -> Result<()> {
        instructions::game::create_game::handler(ctx, game_id, name, username)
    }

    pub fn join_game(ctx: Context<JoinGame>, game_id: [u8; 16], username: String) -> Result<()> {
        instructions::game::join_game::handler(ctx, game_id, username)
    }

    pub fn mint_to_player(
        ctx: Context<MintToPlayer>,
        game_id: [u8; 16],
        username: String,
        player_username: String,
        amount: u64,
    ) -> Result<()> {
        instructions::game::mint_to_player::handler(ctx, game_id, username, player_username, amount)
    }

    pub fn transfer_token(
        ctx: Context<TransferToken>,
        game_id: [u8; 16],
        sender_username: String,
        recipient_username: String,
        amount: u64,
    ) -> Result<()> {
        instructions::general_mode::transfer_token::handler(
            ctx,
            game_id,
            sender_username,
            recipient_username,
            amount,
        )
    }

    pub fn quit_game(ctx: Context<QuitGame>, game_id: [u8; 16], username: String) -> Result<()> {
        instructions::game::quit_game::handler(ctx, game_id, username)
    }
}
