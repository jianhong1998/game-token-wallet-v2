use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::state::{User, MAX_USERNAME_BYTES, MIN_USERNAME_BYTES};

#[derive(Accounts)]
#[instruction(username: String)]
pub struct CreateUser<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + User::INIT_SPACE,
        seeds = [b"user", username.as_bytes(), admin.key().as_ref()],
        bump,
    )]
    pub user: Account<'info, User>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateUser>,
    username: String,
    salt: [u8; 16],
    password_hash: [u8; 64],
) -> Result<()> {
    let byte_len = username.as_bytes().len();
    require!(
        byte_len >= MIN_USERNAME_BYTES && byte_len <= MAX_USERNAME_BYTES,
        ErrorCode::InvalidUsernameLength
    );

    ctx.accounts.user.bump = ctx.bumps.user;
    ctx.accounts.user.username = username;
    ctx.accounts.user.salt = salt;
    ctx.accounts.user.password_hash = password_hash;
    Ok(())
}
