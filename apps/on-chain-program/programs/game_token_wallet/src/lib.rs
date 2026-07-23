use anchor_lang::prelude::*;

mod state;

declare_id!("FHRNx4KK4WzMxXx7X6sK84RvKTKuDVtTGduW3eH9QN9t");

#[program]
pub mod game_token_wallet {
    use super::*;

    pub fn noop(_ctx: Context<Noop>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Noop {}
