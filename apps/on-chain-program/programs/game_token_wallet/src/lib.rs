use anchor_lang::prelude::*;

declare_id!("BWS4UCkFps4XUs7bqqzgNxFZ3keLUMVbb9CJUpyefNob");

#[program]
pub mod game_token_wallet {
    use super::*;

    pub fn noop(_ctx: Context<Noop>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Noop {}
