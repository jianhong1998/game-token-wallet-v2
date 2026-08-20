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
  getQuitGameInstructionAsync,
  findGamePda,
  findUserPda,
  fetchGame,
  GAME_TOKEN_WALLET_ERROR__ADMIN_CANNOT_QUIT_GAME,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
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
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = fill;
  return bytes;
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
    name: "Quit Test Game",
  });
  await buildAndSend(rpc, rpcSubscriptions, hostAdmin, createGameInstruction);
  const [gameAddress] = await findGamePda({ gameId: id });
  return { hostAdmin, id, gameAddress };
}

async function joinedPlayer(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  gameIdBytes: Uint8Array,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
  username: string,
) {
  const admin = await registeredAdmin(rpc, rpcSubscriptions, username);
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
  return { admin, userAddress, playerAta };
}

describe("quit_game instruction", () => {
  it("burns the player's balance, closes their ATA, and decrements player_count", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    // DEVIATION from the plan's literal test file: this scenario calls
    // mint_to_player, which derives BOTH the caller's `user` PDA and the
    // target's `player_user` PDA from the transaction's single `admin`
    // signer (seeds `[b"user", <username>, admin.key()]` — see
    // instructions/game/mint_to_player.rs). That only resolves if host and
    // player were registered under the SAME admin keypair, matching
    // production (one shared custodial system wallet). The plan's generic
    // `createdGame`/`joinedPlayer` helpers mint an independent random
    // keypair per user, which breaks that invariant here — confirmed
    // empirically: this exact scenario failed with a raw AccountNotInitialized
    // (custom program error #3012) on `player_user` when host/player used
    // separate admins. Mirrors the same documented deviation in
    // mint_to_player.test.ts's own `registeredAdmin`.
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const hostUsername = "quithost1";
    const playerUsername = "quitplayer1";

    const createHostUserInstruction = await getCreateUserInstructionAsync({
      admin,
      username: hostUsername,
      salt: new Uint8Array(16),
      passwordHash: new Uint8Array(64),
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, createHostUserInstruction);

    const id = gameId(211);
    const createGameInstruction = await getCreateGameInstructionAsync({
      admin,
      username: hostUsername,
      gameId: id,
      name: "Quit Test Game",
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, createGameInstruction);
    const [gameAddress] = await findGamePda({ gameId: id });
    const gameBefore = await fetchGame(rpc, gameAddress);

    const createPlayerUserInstruction = await getCreateUserInstructionAsync({
      admin,
      username: playerUsername,
      salt: new Uint8Array(16),
      passwordHash: new Uint8Array(64),
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, createPlayerUserInstruction);

    const [playerUserAddress] = await findUserPda({ username: playerUsername, admin: admin.address });
    const [playerAta] = await findAssociatedTokenPda({
      owner: playerUserAddress,
      mint: gameBefore.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const joinGameInstruction = await getJoinGameInstructionAsync({
      admin,
      username: playerUsername,
      gameId: id,
      playerAta,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, joinGameInstruction);

    const gameAfterJoin = await fetchGame(rpc, gameAddress);
    expect(gameAfterJoin.data.playerCount).toBe(2); // host (auto-joined) + this player

    const mintInstruction = await getMintToPlayerInstructionAsync({
      admin,
      username: hostUsername,
      gameId: id,
      playerUsername,
      playerAta,
      amount: 500n,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, mintInstruction);

    const quitInstruction = await getQuitGameInstructionAsync({
      admin,
      username: playerUsername,
      gameId: id,
      playerAta,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, quitInstruction);

    const { value: closedAtaInfo } = await rpc.getAccountInfo(playerAta).send();
    expect(closedAtaInfo).toBeNull();

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(1);
  }, 30_000);

  it("closes the ATA and reclaims rent for a player with a zero balance", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, "quithost5", 215);
    const gameBefore = await fetchGame(rpc, gameAddress);
    const { admin: playerAdmin, playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      id,
      gameBefore.data.mint,
      "quitplayer5",
    );
    const gameAfterJoin = await fetchGame(rpc, gameAddress);
    expect(gameAfterJoin.data.playerCount).toBe(2); // host (auto-joined) + this player

    // No mint_to_player here — the player's balance stays at zero.
    const quitInstruction = await getQuitGameInstructionAsync({
      admin: playerAdmin,
      username: "quitplayer5",
      gameId: id,
      playerAta,
    });
    await buildAndSend(rpc, rpcSubscriptions, playerAdmin, quitInstruction);

    const { value: closedAtaInfo } = await rpc.getAccountInfo(playerAta).send();
    expect(closedAtaInfo).toBeNull();

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(1);
  }, 30_000);

  it("rejects the game's admin with AdminCannotQuitGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { hostAdmin, id, gameAddress } = await createdGame(rpc, rpcSubscriptions, "quithost2", 212);
    const game = await fetchGame(rpc, gameAddress);
    const [hostUserAddress] = await findUserPda({
      username: "quithost2",
      admin: hostAdmin.address,
    });
    const [hostAta] = await findAssociatedTokenPda({
      owner: hostUserAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const quitInstruction = await getQuitGameInstructionAsync({
      admin: hostAdmin,
      username: "quithost2",
      gameId: id,
      playerAta: hostAta,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(hostAdmin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([quitInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the quit to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__ADMIN_CANNOT_QUIT_GAME,
        ),
      ).toBe(true);
    }

    const { value: ataInfo } = await rpc.getAccountInfo(hostAta).send();
    expect(ataInfo).not.toBeNull();
    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(1);
  }, 30_000);

  it("rejects a non-member with PlayerNotInGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, "quithost3", 213);
    const game = await fetchGame(rpc, gameAddress);
    const nonMemberUsername = "quitnonmember3";
    const nonMemberAdmin = await registeredAdmin(rpc, rpcSubscriptions, nonMemberUsername);
    const [nonMemberUserAddress] = await findUserPda({
      username: nonMemberUsername,
      admin: nonMemberAdmin.address,
    });
    const [nonMemberAta] = await findAssociatedTokenPda({
      owner: nonMemberUserAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const quitInstruction = await getQuitGameInstructionAsync({
      admin: nonMemberAdmin,
      username: nonMemberUsername,
      gameId: id,
      playerAta: nonMemberAta,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(nonMemberAdmin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([quitInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the quit to be rejected");
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

  it("allows a player to rejoin after quitting", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const { hostAdmin, id, gameAddress } = await createdGame(rpc, rpcSubscriptions, "quithost4", 214);
    const gameBefore = await fetchGame(rpc, gameAddress);
    const { admin: playerAdmin, playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      id,
      gameBefore.data.mint,
      "quitplayer4",
    );

    const quitInstruction = await getQuitGameInstructionAsync({
      admin: playerAdmin,
      username: "quitplayer4",
      gameId: id,
      playerAta,
    });
    await buildAndSend(rpc, rpcSubscriptions, playerAdmin, quitInstruction);

    const rejoinInstruction = await getJoinGameInstructionAsync({
      admin: playerAdmin,
      username: "quitplayer4",
      gameId: id,
      playerAta,
    });
    await buildAndSend(rpc, rpcSubscriptions, playerAdmin, rejoinInstruction);

    const { value: reopenedAtaInfo } = await rpc.getAccountInfo(playerAta).send();
    expect(reopenedAtaInfo).not.toBeNull();

    const gameAfter = await fetchGame(rpc, gameAddress);
    expect(gameAfter.data.playerCount).toBe(2);

    void hostAdmin; // referenced only via createdGame's return, kept for clarity
  }, 30_000);
});
