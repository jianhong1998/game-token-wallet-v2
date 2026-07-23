use anchor_lang::prelude::*;

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

    pub fn noop(_ctx: Context<Noop>) -> Result<()> {
        Ok(())
    }

    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        instructions::registry::initialize::handler(ctx)
    }
}

#[derive(Accounts)]
pub struct Noop {}
