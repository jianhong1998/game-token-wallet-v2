"use server";

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
import {
  findUserPda,
  findRegistryPda,
  fetchMaybeRegistry,
  fetchGame,
  getCreateGameInstructionAsync,
} from "on-chain-client";
import { normalizeGameName, validateGameName } from "@/lib/game-name";
import { getSolanaContext } from "../connection";
import { generateGameId } from "../game-id";
import { getCurrentUsername } from "./auth";

export interface CreateGameInput {
  name: string;
}

export type CreateGameResult = { ok: true } | { ok: false; error: string };

export async function createGame(input: CreateGameInput): Promise<CreateGameResult> {
  const username = await getCurrentUsername();
  if (!username) {
    return { ok: false, error: "Not signed in" };
  }

  const normalizedName = normalizeGameName(input.name);
  const nameCheck = validateGameName(normalizedName);
  if (!nameCheck.valid) {
    return { ok: false, error: nameCheck.reason };
  }

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();
  const gameId = generateGameId();

  const createGameInstruction = await getCreateGameInstructionAsync(
    { admin: adminSigner, username, gameId, name: normalizedName },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([createGameInstruction], tx),
  );

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });

  return { ok: true };
}

export interface MyGame {
  address: string;
  name: string;
}

export async function listMyGames(): Promise<MyGame[]> {
  const username = await getCurrentUsername();
  if (!username) return [];

  const { rpc, adminSigner, programAddress } = await getSolanaContext();
  const [userAddress] = await findUserPda({ username, admin: adminSigner.address }, { programAddress });
  const [registryAddress] = await findRegistryPda({ programAddress });
  const registry = await fetchMaybeRegistry(rpc, registryAddress);
  if (!registry.exists) return [];

  const games = await Promise.all(
    registry.data.activeGames.map((gameAddress) => fetchGame(rpc, gameAddress)),
  );

  return games
    .filter((game) => game.data.admin === userAddress)
    .map((game) => ({ address: game.address, name: game.data.name }));
}
