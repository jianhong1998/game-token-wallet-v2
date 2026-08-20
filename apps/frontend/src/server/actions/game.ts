"use server";

import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  fetchEncodedAccount,
  unwrapSimulationError,
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
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
  getTransferTokenInstructionAsync,
  getQuitGameInstructionAsync,
  fetchAllUser,
  isGameTokenWalletError,
  GAME_TOKEN_WALLET_ERROR__GAME_FULL,
  GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
  GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT,
  GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER,
  GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT,
  GAME_TOKEN_WALLET_ERROR__ADMIN_CANNOT_QUIT_GAME,
  type GameMode,
} from "on-chain-client";
import {
  findAssociatedTokenPda,
  fetchMaybeToken,
  getTokenDecoder,
  TOKEN_ERROR__INSUFFICIENT_FUNDS,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { normalizeGameName, validateGameName } from "@/lib/game-name";
import { getSolanaContext } from "../connection";
import { generateGameId } from "../game-id";
import { signAndSendTransaction } from "../transaction";
import { chunkInstructionsBySize } from "./transfer-chunking";
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

  // Read at "confirmed" (matching signAndSendTransaction's confirmation
  // level below) rather than the RPC-wide default of "finalized" —
  // "finalized" lags behind "confirmed" and can still see a just-closed ATA
  // (e.g. from a quit_game CPI) as existing, incorrectly rejecting an
  // immediate rejoin.
  const existingAta = await fetchEncodedAccount(rpc, playerAta, { commitment: "confirmed" });
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

  // Reject non-positive/non-finite amounts BEFORE any BigInt/Math.round touches
  // input.amount — NaN and +/-Infinity both crash `BigInt(Math.round(x))` with
  // an uncaught RangeError, so this guard must run first. Checking
  // `input.amount * 100` (not just input.amount) also catches values that are
  // themselves finite but overflow to Infinity once scaled to base units
  // (e.g. 1e307, Number.MAX_VALUE) — that scaled value is what actually flows
  // into Math.round/BigInt below, so it's what must be guaranteed finite.
  if (!(input.amount > 0) || !Number.isFinite(input.amount * 100)) {
    return { ok: false, error: "Amount must be greater than zero" };
  }

  // Amounts are stored on-chain in base units (2 decimal places, i.e. cents).
  // An amount that's positive but rounds to 0 base units (e.g. 0.001) would
  // otherwise sail past the guard above and only fail on-chain with an
  // unfriendly error — so a second guard checks the actual converted value.
  const baseUnitsAmount = BigInt(Math.round(input.amount * 100));
  if (baseUnitsAmount <= 0n) {
    return { ok: false, error: "Amount must be greater than zero" };
  }

  // The on-chain `amount` field is a u64 (max 18446744073709551615). A value
  // like 1e29 is a finite, positive JS number that survives both guards above
  // but overflows u64 once converted to base units — without this check it
  // reaches getMintToPlayerInstructionAsync's codec, which throws an uncaught
  // SolanaError past the friendly-error boundary below (that try/catch only
  // wraps signAndSendTransaction).
  if (baseUnitsAmount > 18446744073709551615n) {
    return { ok: false, error: "Amount is too large" };
  }

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
    if (
      isGameTokenWalletError(
        cause,
        transactionMessage,
        GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT,
      )
    ) {
      return { ok: false, error: "Amount must be greater than zero" };
    }
    throw error;
  }

  return { ok: true };
}

export interface TransferRecipientInput {
  recipientUsername: string;
  amount: number;
}

export interface TransferTokensInput {
  gameAddress: string;
  recipients: TransferRecipientInput[];
}

export type TransferTokensResult =
  | { ok: true }
  | { ok: false; error: string; transfersApplied: number; transfersTotal: number };

export async function transferTokens(input: TransferTokensInput): Promise<TransferTokensResult> {
  const transfersTotal = input.recipients.length;
  const username = await getCurrentUsername();
  if (!username) {
    return { ok: false, error: "Not signed in", transfersApplied: 0, transfersTotal };
  }

  if (transfersTotal === 0) {
    return { ok: false, error: "Add at least one recipient", transfersApplied: 0, transfersTotal };
  }

  const seenRecipients = new Set<string>();
  for (const recipient of input.recipients) {
    if (seenRecipients.has(recipient.recipientUsername)) {
      return {
        ok: false,
        error: `Duplicate recipient: ${recipient.recipientUsername}`,
        transfersApplied: 0,
        transfersTotal,
      };
    }
    seenRecipients.add(recipient.recipientUsername);
    if (recipient.recipientUsername === username) {
      return {
        ok: false,
        error: "Cannot transfer tokens to yourself",
        transfersApplied: 0,
        transfersTotal,
      };
    }
  }

  // Same base-unit guards as depositToPlayer, applied per recipient: reject
  // non-positive/non-finite amounts before BigInt/Math.round, then amounts
  // that round to 0 base units, then amounts that overflow u64.
  const baseUnitsAmounts: bigint[] = [];
  for (const recipient of input.recipients) {
    if (!(recipient.amount > 0) || !Number.isFinite(recipient.amount * 100)) {
      return {
        ok: false,
        error: "Amount must be greater than zero",
        transfersApplied: 0,
        transfersTotal,
      };
    }
    const baseUnits = BigInt(Math.round(recipient.amount * 100));
    if (baseUnits <= 0n) {
      return {
        ok: false,
        error: "Amount must be greater than zero",
        transfersApplied: 0,
        transfersTotal,
      };
    }
    if (baseUnits > 18446744073709551615n) {
      return { ok: false, error: "Amount is too large", transfersApplied: 0, transfersTotal };
    }
    baseUnitsAmounts.push(baseUnits);
  }

  const totalBaseUnits = baseUnitsAmounts.reduce((sum, amount) => sum + amount, 0n);

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();

  const game = await fetchMaybeGame(rpc, input.gameAddress as Address);
  if (!game.exists) {
    return { ok: false, error: "Game not found", transfersApplied: 0, transfersTotal };
  }

  const [senderUserAddress] = await findUserPda(
    { username, admin: adminSigner.address },
    { programAddress },
  );
  const [senderAta] = await findAssociatedTokenPda({
    owner: senderUserAddress,
    mint: game.data.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  // Best-effort pre-flight check against the sender's balance at request
  // time — a concurrent transfer between this check and chunk execution can
  // still make a later chunk fail; that's handled by the
  // stop-on-first-failure send loop below, not by this check (see design.md
  // decision 5).
  const senderToken = await fetchMaybeToken(rpc, senderAta);
  const senderBalance = senderToken.exists ? senderToken.data.amount : 0n;
  if (senderBalance < totalBaseUnits) {
    return {
      ok: false,
      error: "Not enough balance for this transfer",
      transfersApplied: 0,
      transfersTotal,
    };
  }

  const instructions = await Promise.all(
    input.recipients.map(async (recipient, index) => {
      const [recipientUserAddress] = await findUserPda(
        { username: recipient.recipientUsername, admin: adminSigner.address },
        { programAddress },
      );
      const [recipientAta] = await findAssociatedTokenPda({
        owner: recipientUserAddress,
        mint: game.data.mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      return getTransferTokenInstructionAsync(
        {
          admin: adminSigner,
          gameId: game.data.gameId,
          senderUsername: username,
          recipientUsername: recipient.recipientUsername,
          senderAta,
          recipientAta,
          amount: baseUnitsAmounts[index],
        },
        { programAddress },
      );
    }),
  );

  const chunks = chunkInstructionsBySize(instructions, adminSigner.address);

  let transfersApplied = 0;
  for (const chunk of chunks) {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions(chunk, tx),
    );
    try {
      await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });
    } catch (error) {
      const cause = unwrapSimulationError(error);
      let friendly: string;
      if (isGameTokenWalletError(cause, transactionMessage, GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER)) {
        friendly = "Cannot transfer tokens to yourself";
      } else if (
        isGameTokenWalletError(cause, transactionMessage, GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT)
      ) {
        friendly = "Amount must be greater than zero";
      } else if (
        isGameTokenWalletError(cause, transactionMessage, GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME)
      ) {
        friendly = "That player hasn't joined this game";
      } else if (
        isSolanaError(cause, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM) &&
        cause.context.code === TOKEN_ERROR__INSUFFICIENT_FUNDS
      ) {
        friendly = "Not enough balance for this transfer";
      } else {
        throw error;
      }
      return { ok: false, error: friendly, transfersApplied, transfersTotal };
    }
    transfersApplied += chunk.length;
  }

  return { ok: true };
}

export type QuitGameResult = { ok: true } | { ok: false; error: string };

export async function quitGame(gameAddress: string): Promise<QuitGameResult> {
  const username = await getCurrentUsername();
  if (!username) {
    return { ok: false, error: "Not signed in" };
  }

  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();

  const game = await fetchMaybeGame(rpc, gameAddress as Address);
  if (!game.exists) {
    return { ok: false, error: "Game not found" };
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

  const quitGameInstruction = await getQuitGameInstructionAsync(
    { admin: adminSigner, username, gameId: game.data.gameId, playerAta },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([quitGameInstruction], tx),
  );
  try {
    await signAndSendTransaction(transactionMessage, { rpc, rpcSubscriptions });
  } catch (error) {
    const cause = unwrapSimulationError(error);
    if (
      isGameTokenWalletError(
        cause,
        transactionMessage,
        GAME_TOKEN_WALLET_ERROR__ADMIN_CANNOT_QUIT_GAME,
      )
    ) {
      return { ok: false, error: "Transfer admin role to another player before quitting" };
    }
    if (
      isGameTokenWalletError(
        cause,
        transactionMessage,
        GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
      )
    ) {
      return { ok: false, error: "You are not a player in this game" };
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
