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
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getCreateUserInstructionAsync,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
  getMintToPlayerInstructionAsync,
  getCloseGamePlayerInstructionAsync,
  getCloseGameInstructionAsync,
  findGamePda,
  findUserPda,
  findRegistryPda,
  fetchGame,
  fetchRegistry,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
  GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY,
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

// One shared `admin` keypair registers every username in a scenario — see
// this file's DEVIATION-avoidance note: close_game_player derives BOTH the
// caller's `user` PDA and the target's `player_user` PDA from a single
// `admin: Signer`, exactly like mint_to_player.rs. Using a different random
// admin per user (as create_game.test.ts/join_game.test.ts do, where it's
// safe because those instructions only ever resolve one user) breaks that
// invariant here.
async function registeredAdmin(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  username: string,
): Promise<void> {
  const createUserInstruction = await getCreateUserInstructionAsync({
    admin,
    username,
    salt: new Uint8Array(16),
    passwordHash: new Uint8Array(64),
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, createUserInstruction);
}

function gameId(fill: number): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = fill;
  return bytes;
}

async function createdGame(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  hostUsername: string,
  idFill: number,
) {
  await registeredAdmin(rpc, rpcSubscriptions, admin, hostUsername);
  const id = gameId(idFill);
  const createGameInstruction = await getCreateGameInstructionAsync({
    admin,
    username: hostUsername,
    gameId: id,
    name: "Close Test Game",
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, createGameInstruction);
  const [gameAddress] = await findGamePda({ gameId: id });
  return { id, gameAddress };
}

async function joinedPlayer(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  gameIdBytes: Uint8Array,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
  username: string,
) {
  await registeredAdmin(rpc, rpcSubscriptions, admin, username);
  const [userAddress] = await findUserPda({ username, admin: admin.address });
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
  return { playerAta };
}

async function closePlayer(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  hostUsername: string,
  gameIdBytes: Uint8Array,
  playerUsername: string,
  playerAta: Parameters<typeof getCloseGamePlayerInstructionAsync>[0]["playerAta"],
): Promise<void> {
  const instruction = await getCloseGamePlayerInstructionAsync({
    admin,
    username: hostUsername,
    gameId: gameIdBytes,
    playerUsername,
    playerAta,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, instruction);
}

describe("close_game_player instruction", () => {
  it("burns a non-admin player's balance, closes their ATA, and decrements player_count", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost1", 231);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "closeplayer1",
    );
    const mintInstruction = await getMintToPlayerInstructionAsync({
      admin,
      username: "closehost1",
      gameId: id,
      playerUsername: "closeplayer1",
      playerAta,
      amount: 500n,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, mintInstruction);

    const gameBeforeClose = await fetchGame(rpc, gameAddress);
    expect(gameBeforeClose.data.playerCount).toBe(2); // host (auto-joined) + this player

    await closePlayer(rpc, rpcSubscriptions, admin, "closehost1", id, "closeplayer1", playerAta);

    const { value: closedAtaInfo } = await rpc.getAccountInfo(playerAta).send();
    expect(closedAtaInfo).toBeNull();

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(1);
  }, 30_000);

  it("closes the admin's own player slot via the same instruction", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost2", 232);
    const game = await fetchGame(rpc, gameAddress);
    const [hostUserAddress] = await findUserPda({ username: "closehost2", admin: admin.address });
    const [hostAta] = await findAssociatedTokenPda({
      owner: hostUserAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    await closePlayer(rpc, rpcSubscriptions, admin, "closehost2", id, "closehost2", hostAta);

    const { value: closedAtaInfo } = await rpc.getAccountInfo(hostAta).send();
    expect(closedAtaInfo).toBeNull();

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(0);
  }, 30_000);

  it("rejects a target who is not a member with PlayerNotInGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost3", 233);
    const game = await fetchGame(rpc, gameAddress);
    const nonMemberUsername = "closenonmember3";
    await registeredAdmin(rpc, rpcSubscriptions, admin, nonMemberUsername);
    const [nonMemberUserAddress] = await findUserPda({
      username: nonMemberUsername,
      admin: admin.address,
    });
    const [nonMemberAta] = await findAssociatedTokenPda({
      owner: nonMemberUserAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const instruction = await getCloseGamePlayerInstructionAsync({
      admin,
      username: "closehost3",
      gameId: id,
      playerUsername: nonMemberUsername,
      playerAta: nonMemberAta,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([instruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected close_game_player to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
        ),
      ).toBe(true);
    }

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(1);
  }, 30_000);

  it("rejects a non-admin caller with NotGameAdmin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost4", 234);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "closeplayer4",
    );
    const impostorUsername = "closeimpostor4";
    await registeredAdmin(rpc, rpcSubscriptions, admin, impostorUsername);

    const instruction = await getCloseGamePlayerInstructionAsync({
      admin,
      username: impostorUsername,
      gameId: id,
      playerUsername: "closeplayer4",
      playerAta,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([instruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected close_game_player to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
        ),
      ).toBe(true);
    }

    const { value: ataInfo } = await rpc.getAccountInfo(playerAta).send();
    expect(ataInfo).not.toBeNull();
    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(2);
  }, 30_000);
});

describe("close_game instruction", () => {
  it("closes an empty game: prunes the registry, closes the Game account, leaves the mint untouched", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost5", 235);
    const game = await fetchGame(rpc, gameAddress);
    const mintAddress = game.data.mint;
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      mintAddress,
      "closeplayer5",
    );
    const [hostUserAddress] = await findUserPda({ username: "closehost5", admin: admin.address });
    const [hostAta] = await findAssociatedTokenPda({
      owner: hostUserAddress,
      mint: mintAddress,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const [registryAddress] = await findRegistryPda();
    const registryBefore = await fetchRegistry(rpc, registryAddress);
    expect(registryBefore.data.activeGames).toContain(gameAddress);

    // Close every player (host + the one joined player) before finalizing.
    await closePlayer(rpc, rpcSubscriptions, admin, "closehost5", id, "closeplayer5", playerAta);
    await closePlayer(rpc, rpcSubscriptions, admin, "closehost5", id, "closehost5", hostAta);

    const gameBeforeFinalize = await fetchGame(rpc, gameAddress);
    expect(gameBeforeFinalize.data.playerCount).toBe(0);

    const closeGameInstruction = await getCloseGameInstructionAsync({
      admin,
      username: "closehost5",
      gameId: id,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, closeGameInstruction);

    const { value: gameAccountInfo } = await rpc.getAccountInfo(gameAddress).send();
    expect(gameAccountInfo).toBeNull();

    const registryAfter = await fetchRegistry(rpc, registryAddress);
    expect(registryAfter.data.activeGames).not.toContain(gameAddress);

    // The mint is never closed — legacy SPL Token program has no
    // mint-closing instruction (design.md D3's correction note).
    const { value: mintAccountInfo } = await rpc.getAccountInfo(mintAddress).send();
    expect(mintAccountInfo).not.toBeNull();
  }, 30_000);

  it("rejects closing a non-empty game with GameNotEmpty", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    // Host is auto-joined at creation, so player_count is 1 — never closed
    // out here, so close_game must reject.
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost6", 236);

    const closeGameInstruction = await getCloseGameInstructionAsync({
      admin,
      username: "closehost6",
      gameId: id,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([closeGameInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected close_game to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY,
        ),
      ).toBe(true);
    }

    const { value: gameAccountInfo } = await rpc.getAccountInfo(gameAddress).send();
    expect(gameAccountInfo).not.toBeNull();
  }, 30_000);

  it("rejects a non-admin caller with NotGameAdmin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "closehost7", 237);
    const impostorUsername = "closeimpostor7";
    await registeredAdmin(rpc, rpcSubscriptions, admin, impostorUsername);

    const closeGameInstruction = await getCloseGameInstructionAsync({
      admin,
      username: impostorUsername,
      gameId: id,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([closeGameInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected close_game to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
        ),
      ).toBe(true);
    }

    const { value: gameAccountInfo } = await rpc.getAccountInfo(gameAddress).send();
    expect(gameAccountInfo).not.toBeNull();
  }, 30_000);
});
