"use server";

import { cookies, headers } from "next/headers";
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
  const requestHeaders = await headers();
  // secure must reflect the actual inbound request's protocol, not build mode:
  // NODE_ENV is unconditionally "production" in the frontend's production
  // Docker image (next build && next start), but that image is also what
  // serves plain HTTP in e2e/local Docker stacks with no TLS-terminating
  // reverse proxy in front. Browsers refuse to store a Secure cookie over a
  // non-HTTPS connection, so gating on NODE_ENV silently drops every session.
  const isHttps = requestHeaders.get("x-forwarded-proto") === "https";
  cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isHttps,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export type AuthActionResult = { ok: true } | { ok: false; error: string };

export async function registerUser(input: RegisterUserInput): Promise<AuthActionResult> {
  const normalizedUsername = normalizeUsername(input.username);

  const usernameCheck = validateUsername(normalizedUsername);
  if (!usernameCheck.valid) {
    return { ok: false, error: usernameCheck.reason };
  }

  const passwordCheck = validatePassword(input.password);
  if (!passwordCheck.valid) {
    return { ok: false, error: passwordCheck.reason };
  }

  if (input.password !== input.confirmPassword) {
    return { ok: false, error: "Passwords do not match" };
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
      return { ok: false, error: "Username already taken" };
    }
    throw error;
  }

  await setSessionCookie(normalizedUsername);
  return { ok: true };
}

export interface LoginUserInput {
  username: string;
  password: string;
}

const INVALID_CREDENTIALS_MESSAGE = "Invalid username or password";

export async function loginUser(input: LoginUserInput): Promise<AuthActionResult> {
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
    return { ok: false, error: INVALID_CREDENTIALS_MESSAGE };
  }

  const passwordMatches = await verifyPassword(
    input.password,
    new Uint8Array(maybeUser.data.salt),
    new Uint8Array(maybeUser.data.passwordHash),
  );

  if (!passwordMatches) {
    return { ok: false, error: INVALID_CREDENTIALS_MESSAGE };
  }

  await setSessionCookie(normalizedUsername);
  return { ok: true };
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
