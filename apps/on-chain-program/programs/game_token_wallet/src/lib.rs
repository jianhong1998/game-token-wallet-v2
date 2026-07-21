use anchor_lang::prelude::*;

declare_id!("4qetKWMztCYZLp9zqLZiNjmnSfy13JM5VAjkKmU8g42X");

#[program]
pub mod game_token_wallet {
    use super::*;

    pub fn noop(_ctx: Context<Noop>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Noop {}
