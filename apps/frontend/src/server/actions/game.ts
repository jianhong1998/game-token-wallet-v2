"use server";

import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  fetchEncodedAccount,
  unwrapSimulationError,
  type Address,
  type Base58EncodedBytes,
} from "@solana/kit";
import {
  findUserPda,
  findRegistryPda,
  fetchMaybeRegistry,
  fetchGame,
  fetchMaybeGame,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
  getMintToPlayerInstructionAsync,
  fetchAllUser,
  isGameTokenWalletError,
  GAME_TOKEN_WALLET_ERROR__GAME_FULL,
  GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
  type GameMode,
} from "on-chain-client";
import {
  findAssociatedTokenPda,
  getTokenDecoder,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
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
  try {
    await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });
  } catch (error) {
    // The client-side checks above (player cap, existing ATA) are best-effort
    // pre-checks against possibly-stale state — under a race (two players
    // joining a near-full game, or a stale browse-list) the on-chain program
    // is still the source of truth and can reject with GameFull or
    // AlreadyJoinedGame even after those checks passed. Map only those known
    // program errors to the same friendly messages the pre-checks use; any
    // other error is unexpected and rethrown (same convention as
    // registerUser's catch in ./auth.ts).
    const cause = unwrapSimulationError(error);
    if (isGameTokenWalletError(cause, transactionMessage, GAME_TOKEN_WALLET_ERROR__GAME_FULL)) {
      return { ok: false, error: "This game already has the maximum of 20 players" };
    }
    if (
      isGameTokenWalletError(
        cause,
        transactionMessage,
        GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME,
      )
    ) {
      return { ok: false, error: "You are already a player in this game" };
    }
    throw error;
  }

  return { ok: true };
}

export interface DepositToPlayerInput {
  gameAddress: string;
  playerUsername: string;
  amount: number;
}

export type DepositToPlayerResult = { ok: true } | { ok: false; error: string };

export async function depositToPlayer(
  input: DepositToPlayerInput,
): Promise<DepositToPlayerResult> {
  const username = await getCurrentUsername();
  if (!username) {
    return { ok: false, error: "Not signed in" };
  }

  if (!(input.amount > 0)) {
    return { ok: false, error: "Amount must be greater than zero" };
  }
  const baseUnitsAmount = BigInt(Math.round(input.amount * 100));

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();

  const game = await fetchMaybeGame(rpc, input.gameAddress as Address);
  if (!game.exists) {
    return { ok: false, error: "Game not found" };
  }

  const [playerUserAddress] = await findUserPda(
    { username: input.playerUsername, admin: adminSigner.address },
    { programAddress },
  );
  const [playerAta] = await findAssociatedTokenPda({
    owner: playerUserAddress,
    mint: game.data.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const mintToPlayerInstruction = await getMintToPlayerInstructionAsync(
    {
      admin: adminSigner,
      username,
      gameId: game.data.gameId,
      playerUsername: input.playerUsername,
      playerAta,
      amount: baseUnitsAmount,
    },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([mintToPlayerInstruction], tx),
  );
  try {
    await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });
  } catch (error) {
    const cause = unwrapSimulationError(error);
    if (
      isGameTokenWalletError(cause, transactionMessage, GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN)
    ) {
      return { ok: false, error: "Only the game's admin can deposit tokens" };
    }
    if (
      isGameTokenWalletError(
        cause,
        transactionMessage,
        GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
      )
    ) {
      return { ok: false, error: "That player hasn't joined this game" };
    }
    throw error;
  }

  return { ok: true };
}

// Shared fetch pipeline for both listBrowseGames and listMyMemberGames:
// resolve the registry's active games, derive the caller's PDA, then
// batch-fetch one ATA per game in a single getMultipleAccounts call.
// Returns null when there's no signed-in user or the registry doesn't exist
// yet, so callers can just `?? []` (or equivalent) at the call site.
async function fetchGamesWithMyAtas(username: string) {
  const { rpc, adminSigner, programAddress } = await getSolanaContext();
  const [registryAddress] = await findRegistryPda({ programAddress });
  const registry = await fetchMaybeRegistry(rpc, registryAddress);
  if (!registry.exists) return null;

  const games = await Promise.all(
    registry.data.activeGames.map((gameAddress) => fetchGame(rpc, gameAddress)),
  );

  const [userAddress] = await findUserPda(
    { username, admin: adminSigner.address },
    { programAddress },
  );
  const atas = await Promise.all(
    games.map(({ data }) =>
      findAssociatedTokenPda({
        owner: userAddress,
        mint: data.mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      }),
    ),
  );
  const ataAddresses = atas.map(([address]) => address);
  const { value: ataAccounts } = ataAddresses.length
    ? await rpc.getMultipleAccounts(ataAddresses).send()
    : { value: [] as ({ data: [string, string] } | null)[] };

  return { games, userAddress, ataAccounts };
}

export interface BrowseGame {
  address: string;
  name: string;
  mode: GameMode;
  playerCount: number;
  isMember: boolean;
}

export async function listBrowseGames(): Promise<BrowseGame[]> {
  const username = await getCurrentUsername();
  if (!username) return [];

  const result = await fetchGamesWithMyAtas(username);
  if (!result) return [];
  const { games, ataAccounts } = result;

  return games.map((game, index) => ({
    address: game.address,
    name: game.data.name,
    mode: game.data.mode,
    playerCount: game.data.playerCount,
    isMember: ataAccounts[index] !== null,
  }));
}

export interface MemberGame {
  address: string;
  name: string;
  mode: GameMode;
  balance: number;
  isAdmin: boolean;
}

export async function listMyMemberGames(): Promise<MemberGame[]> {
  const username = await getCurrentUsername();
  if (!username) return [];

  const result = await fetchGamesWithMyAtas(username);
  if (!result) return [];
  const { games, userAddress, ataAccounts } = result;

  const tokenDecoder = getTokenDecoder();

  const memberGames: MemberGame[] = [];
  games.forEach((game, index) => {
    const isAdmin = game.data.admin === userAddress;
    const ataAccount = ataAccounts[index];
    const isPlayer = ataAccount !== null;
    if (!isAdmin && !isPlayer) return;

    const balance = ataAccount
      ? Number(tokenDecoder.decode(Buffer.from(ataAccount.data[0], "base64")).amount) / 100
      : 0;

    memberGames.push({
      address: game.address,
      name: game.data.name,
      mode: game.data.mode,
      balance,
      isAdmin,
    });
  });

  return memberGames;
}

export interface GamePlayer {
  username: string;
  balance: number;
  isAdmin: boolean;
}

export interface GameDetail {
  address: string;
  name: string;
  mode: GameMode;
  isAdmin: boolean;
  myBalance: number;
  players: GamePlayer[];
}

export async function fetchGameDetail(gameAddress: string): Promise<GameDetail | null> {
  const username = await getCurrentUsername();
  if (!username) return null;

  const { rpc, adminSigner, programAddress } = await getSolanaContext();
  const game = await fetchMaybeGame(rpc, gameAddress as Address);
  if (!game.exists) return null;

  const [userAddress] = await findUserPda(
    { username, admin: adminSigner.address },
    { programAddress },
  );

  const { value: tokenAccounts } = await rpc
    .getProgramAccounts(TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      withContext: true,
      filters: [
        { dataSize: 165n },
        {
          memcmp: {
            offset: 0n,
            bytes: game.data.mint as unknown as Base58EncodedBytes,
            encoding: "base58",
          },
        },
      ],
    })
    .send();

  const tokenDecoder = getTokenDecoder();
  const holders = tokenAccounts.map(({ account }) => {
    const decoded = tokenDecoder.decode(Buffer.from(account.data[0], "base64"));
    return { owner: decoded.owner, balance: Number(decoded.amount) / 100 };
  });

  const owners = holders.map((holder) => holder.owner);
  const userAccounts = owners.length ? await fetchAllUser(rpc, owners) : [];

  const players: GamePlayer[] = holders.map((holder, index) => ({
    username: userAccounts[index].data.username,
    balance: holder.balance,
    isAdmin: holder.owner === game.data.admin,
  }));

  const myHolderIndex = owners.findIndex((owner) => owner === userAddress);

  return {
    address: game.address,
    name: game.data.name,
    mode: game.data.mode,
    isAdmin: game.data.admin === userAddress,
    myBalance: myHolderIndex === -1 ? 0 : holders[myHolderIndex].balance,
    players,
  };
}
