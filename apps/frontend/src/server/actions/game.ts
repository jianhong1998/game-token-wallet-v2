"use server";

import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  fetchEncodedAccount,
  type Address,
} from "@solana/kit";
import {
  findUserPda,
  findRegistryPda,
  fetchMaybeRegistry,
  fetchGame,
  fetchMaybeGame,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
} from "on-chain-client";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { normalizeGameName, validateGameName } from "@/lib/game-name";
import { getSolanaContext } from "../connection";
import { generateGameId } from "../game-id";
import { signAndSendTransaction } from "../transaction";
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

  await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });

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
  const [userAddress] = await findUserPda(
    { username, admin: adminSigner.address },
    { programAddress },
  );
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

// Mirrors the on-chain `MAX_PLAYERS_PER_GAME` constant
// (apps/on-chain-program/programs/game_token_wallet/src/state/game.rs) —
// duplicated here only for a friendly pre-check; the on-chain `GameFull`
// error is still the actual correctness guarantee.
const MAX_PLAYERS_PER_GAME = 20;

export type JoinGameResult = { ok: true } | { ok: false; error: string };

export async function joinGame(gameAddress: string): Promise<JoinGameResult> {
  const username = await getCurrentUsername();
  if (!username) {
    return { ok: false, error: "Not signed in" };
  }

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();

  const game = await fetchMaybeGame(rpc, gameAddress as Address);
  if (!game.exists) {
    return { ok: false, error: "Game not found" };
  }
  if (game.data.playerCount >= MAX_PLAYERS_PER_GAME) {
    return { ok: false, error: "This game already has the maximum of 20 players" };
  }

  const [userAddress] = await findUserPda(
    { username, admin: adminSigner.address },
    { programAddress },
  );
  const [playerAta] = await findAssociatedTokenPda({
    owner: userAddress,
    mint: game.data.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const existingAta = await fetchEncodedAccount(rpc, playerAta);
  if (existingAta.exists) {
    return { ok: false, error: "You are already a player in this game" };
  }

  const joinGameInstruction = await getJoinGameInstructionAsync(
    { admin: adminSigner, username, gameId: game.data.gameId, playerAta },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([joinGameInstruction], tx),
  );
  await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });

  return { ok: true };
}
