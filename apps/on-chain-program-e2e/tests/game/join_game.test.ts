import { describe, it, expect } from "vitest";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  airdropFactory,
  lamports,
  assertIsTransactionWithBlockhashLifetime,
  unwrapSimulationError,
  type KeyPairSigner,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import { findAssociatedTokenPda, fetchToken, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getCreateUserInstructionAsync,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
  findGamePda,
  fetchGame,
  GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME,
  GAME_TOKEN_WALLET_ERROR__GAME_FULL,
  isGameTokenWalletError,
} from "on-chain-client";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS_URL = process.env.SOLANA_RPC_WS_URL ?? "ws://127.0.0.1:8900";

async function fundedAdmin(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
): Promise<KeyPairSigner> {
  const admin = await generateKeyPairSigner();
  const airdrop = airdropFactory({ rpc, rpcSubscriptions });
  await airdrop({
    commitment: "confirmed",
    recipientAddress: admin.address,
    lamports: lamports(1_000_000_000n),
  });
  return admin;
}

async function buildAndSend(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  payer: KeyPairSigner,
  instruction: { programAddress: unknown; accounts: unknown; data: unknown },
): Promise<void> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([instruction as never], tx),
  );
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
}

async function registeredAdmin(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  username: string,
): Promise<KeyPairSigner> {
  const admin = await fundedAdmin(rpc, rpcSubscriptions);
  const createUserInstruction = await getCreateUserInstructionAsync({
    admin,
    username,
    salt: new Uint8Array(16),
    passwordHash: new Uint8Array(64),
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, createUserInstruction);
  return admin;
}

function gameId(fill: number): Uint8Array {
  return new Uint8Array(16).fill(fill);
}

async function createdGame(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  hostUsername: string,
  idFill: number,
) {
  const hostAdmin = await registeredAdmin(rpc, rpcSubscriptions, hostUsername);
  const id = gameId(idFill);
  const createGameInstruction = await getCreateGameInstructionAsync({
    admin: hostAdmin,
    username: hostUsername,
    gameId: id,
    name: "Join Test Game",
  });
  await buildAndSend(rpc, rpcSubscriptions, hostAdmin, createGameInstruction);
  const [gameAddress] = await findGamePda({ gameId: id });
  return { hostAdmin, id, gameAddress };
}

async function joinAsNewUser(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  gameIdBytes: Uint8Array,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
  username: string,
): Promise<void> {
  const admin = await registeredAdmin(rpc, rpcSubscriptions, username);
  const [userAddress] = await import("on-chain-client").then((m) =>
    m.findUserPda({ username, admin: admin.address }),
  );
  const [playerAta] = await findAssociatedTokenPda({
    owner: userAddress,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const joinGameInstruction = await getJoinGameInstructionAsync({
    admin,
    username,
    gameId: gameIdBytes,
    playerAta,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, joinGameInstruction);
}

describe("join_game instruction", () => {
  it("creates the player's ATA and increments player_count", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { gameAddress, id } = await createdGame(rpc, rpcSubscriptions, "joinhost1", 101);

    const gameBefore = await fetchGame(rpc, gameAddress);
    expect(gameBefore.data.playerCount).toBe(0);

    const playerAdmin = await registeredAdmin(rpc, rpcSubscriptions, "joiner1");
    const { findUserPda } = await import("on-chain-client");
    const [userAddress] = await findUserPda({ username: "joiner1", admin: playerAdmin.address });
    const [playerAta] = await findAssociatedTokenPda({
      owner: userAddress,
      mint: gameBefore.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const joinGameInstruction = await getJoinGameInstructionAsync({
      admin: playerAdmin,
      username: "joiner1",
      gameId: id,
      playerAta,
    });
    await buildAndSend(rpc, rpcSubscriptions, playerAdmin, joinGameInstruction);

    const token = await fetchToken(rpc, playerAta);
    expect(token.data.owner).toBe(userAddress);
    expect(token.data.amount).toBe(0n);

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(1);
  }, 30_000);

  it("rejects a second join by the same player with AlreadyJoinedGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { gameAddress, id } = await createdGame(rpc, rpcSubscriptions, "joinhost2", 102);
    const game = await fetchGame(rpc, gameAddress);

    const playerAdmin = await registeredAdmin(rpc, rpcSubscriptions, "joiner2");
    const { findUserPda } = await import("on-chain-client");
    const [userAddress] = await findUserPda({ username: "joiner2", admin: playerAdmin.address });
    const [playerAta] = await findAssociatedTokenPda({
      owner: userAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const firstJoin = await getJoinGameInstructionAsync({
      admin: playerAdmin,
      username: "joiner2",
      gameId: id,
      playerAta,
    });
    await buildAndSend(rpc, rpcSubscriptions, playerAdmin, firstJoin);

    const secondJoin = await getJoinGameInstructionAsync({
      admin: playerAdmin,
      username: "joiner2",
      gameId: id,
      playerAta,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(playerAdmin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([secondJoin], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the second join to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME,
        ),
      ).toBe(true);
    }

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(1);
  }, 30_000);

  it("rejects the 21st join with GameFull, leaving player_count at 20", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { gameAddress, id } = await createdGame(rpc, rpcSubscriptions, "joinhost3", 103);
    const game = await fetchGame(rpc, gameAddress);

    for (let i = 0; i < 20; i += 1) {
      await joinAsNewUser(rpc, rpcSubscriptions, id, game.data.mint, `capjoiner${i}`);
    }

    const gameAtCapacity = await fetchGame(rpc, gameAddress);
    expect(gameAtCapacity.data.playerCount).toBe(20);

    const overflowAdmin = await registeredAdmin(rpc, rpcSubscriptions, "capjoinerOverflow");
    const { findUserPda } = await import("on-chain-client");
    const [userAddress] = await findUserPda({
      username: "capjoinerOverflow",
      admin: overflowAdmin.address,
    });
    const [playerAta] = await findAssociatedTokenPda({
      owner: userAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const overflowJoin = await getJoinGameInstructionAsync({
      admin: overflowAdmin,
      username: "capjoinerOverflow",
      gameId: id,
      playerAta,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(overflowAdmin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([overflowJoin], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the 21st join to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__GAME_FULL,
        ),
      ).toBe(true);
    }

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(20);
  }, 90_000);
});
