use anchor_lang::prelude::*;

use crate::state::Registry;

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Registry::INIT_SPACE,
        seeds = [b"registry"],
        bump,
    )]
    pub registry: Account<'info, Registry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeRegistry>) -> Result<()> {
    ctx.accounts.registry.bump = ctx.bumps.registry;
    Ok(())
}
