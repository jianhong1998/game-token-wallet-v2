"use server";

import { cookies } from "next/headers";
import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit";
import { findUserPda, fetchMaybeUser, getCreateUserInstructionAsync } from "on-chain-client";
import { normalizeUsername, validateUsername } from "@/lib/username";
import { validatePassword } from "@/lib/password-rules";
import { getSolanaContext } from "../connection";
import { hashPassword } from "../password";
import {
  createSessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "../session";

export interface RegisterUserInput {
  username: string;
  password: string;
  confirmPassword: string;
}

async function setSessionCookie(username: string): Promise<void> {
  const sessionCookie = await createSessionCookie(username);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function registerUser(input: RegisterUserInput): Promise<void> {
  const normalizedUsername = normalizeUsername(input.username);

  const usernameCheck = validateUsername(normalizedUsername);
  if (!usernameCheck.valid) {
    throw new Error(usernameCheck.reason);
  }

  const passwordCheck = validatePassword(input.password);
  if (!passwordCheck.valid) {
    throw new Error(passwordCheck.reason);
  }

  if (input.password !== input.confirmPassword) {
    throw new Error("Passwords do not match");
  }

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();
  const { salt, hash } = await hashPassword(input.password);

  const createUserInstruction = await getCreateUserInstructionAsync(
    { admin: adminSigner, username: normalizedUsername, salt, passwordHash: hash },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([createUserInstruction], tx),
  );

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  try {
    await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
  } catch (error) {
    // The duplicate-username case fails Anchor's `init` constraint — rather
    // than string-matching the error, re-check whether the account now
    // exists (same idempotency-check pattern as registry.ts's initializeRegistry).
    const [userAddress] = await findUserPda(
      { username: normalizedUsername, admin: adminSigner.address },
      { programAddress },
    );
    const existing = await fetchMaybeUser(rpc, userAddress);
    if (existing.exists) {
      throw new Error("Username already taken", { cause: error });
    }
    throw error;
  }

  await setSessionCookie(normalizedUsername);
}
