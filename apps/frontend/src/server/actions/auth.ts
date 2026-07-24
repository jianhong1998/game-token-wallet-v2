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
import { hashPassword, verifyPassword, runDummyHash } from "../password";
import {
  createSessionCookie,
  verifySessionCookie,
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

export interface LoginUserInput {
  username: string;
  password: string;
}

const INVALID_CREDENTIALS_MESSAGE = "Invalid username or password";

export async function loginUser(input: LoginUserInput): Promise<void> {
  const normalizedUsername = normalizeUsername(input.username);
  const { rpc, adminSigner, programAddress } = await getSolanaContext();

  const [userAddress] = await findUserPda(
    { username: normalizedUsername, admin: adminSigner.address },
    { programAddress },
  );
  const maybeUser = await fetchMaybeUser(rpc, userAddress);

  if (!maybeUser.exists) {
    // Still pay the scrypt cost even though there's no account, so response
    // timing doesn't reveal that this username doesn't exist.
    await runDummyHash(input.password);
    throw new Error(INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await verifyPassword(
    input.password,
    new Uint8Array(maybeUser.data.salt),
    new Uint8Array(maybeUser.data.passwordHash),
  );

  if (!passwordMatches) {
    throw new Error(INVALID_CREDENTIALS_MESSAGE);
  }

  await setSessionCookie(normalizedUsername);
}

export async function logoutUser(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUsername(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;
  const session = await verifySessionCookie(sessionCookie);
  return session?.username ?? null;
}
