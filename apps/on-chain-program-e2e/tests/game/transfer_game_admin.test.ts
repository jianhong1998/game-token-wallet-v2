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
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  type KeyPairSigner,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
  type Address,
} from "@solana/kit";
import { findAssociatedTokenPda, fetchToken, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getCreateUserInstructionAsync,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
  getMintToPlayerInstructionAsync,
  getTransferGameAdminInstructionAsync,
  getQuitGameInstructionAsync,
  getCloseGameInstructionAsync,
  findGamePda,
  findUserPda,
  fetchGame,
  fetchMaybeGame,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
  GAME_TOKEN_WALLET_ERROR__INVALID_PLAYER_ATA,
  GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF,
  GAME_TOKEN_WALLET_ERROR__ADMIN_CANNOT_QUIT_GAME,
  GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY,
  isGameTokenWalletError,
  type GameTokenWalletError,
} from "on-chain-client";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS_URL = process.env.SOLANA_RPC_WS_URL ?? "ws://127.0.0.1:8900";

type Instruction = { programAddress: unknown; accounts: unknown; data: unknown };

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
  instruction: Instruction,
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

async function expectProgramError(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  payer: KeyPairSigner,
  instruction: Instruction,
  code: GameTokenWalletError,
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

  try {
    await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
    expect.fail("expected the transaction to be rejected");
  } catch (error) {
    expect(isGameTokenWalletError(unwrapSimulationError(error), transactionMessage, code)).toBe(
      true,
    );
  }
}

// One shared system signer per test, for the host and every other user.
// `transfer_game_admin` derives both `user` and `player_user` from that
// signer, same as `mint_to_player`. A per-user random keypair fails with
// AccountNotInitialized before the handler runs. See the DEVIATION comment
// in mint_to_player.test.ts.
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
  name = "Transfer Test Game",
) {
  await registeredAdmin(rpc, rpcSubscriptions, admin, hostUsername);
  const id = gameId(idFill);
  const createGameInstruction = await getCreateGameInstructionAsync({
    admin,
    username: hostUsername,
    gameId: id,
    name,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, createGameInstruction);
  const [gameAddress] = await findGamePda({ gameId: id });
  return { id, gameAddress };
}

async function derivedAta(
  admin: KeyPairSigner,
  username: string,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
) {
  const [userAddress] = await findUserPda({ username, admin: admin.address });
  const [playerAta] = await findAssociatedTokenPda({
    owner: userAddress,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return { userAddress, playerAta };
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
  const { userAddress, playerAta } = await derivedAta(admin, username, mint);
  const joinGameInstruction = await getJoinGameInstructionAsync({
    admin,
    username,
    gameId: gameIdBytes,
    playerAta,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, joinGameInstruction);
  return { userAddress, playerAta };
}

async function joinExistingPlayer(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  gameIdBytes: Uint8Array,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
  username: string,
) {
  const { userAddress, playerAta } = await derivedAta(admin, username, mint);
  const joinGameInstruction = await getJoinGameInstructionAsync({
    admin,
    username,
    gameId: gameIdBytes,
    playerAta,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, joinGameInstruction);
  return { userAddress, playerAta };
}

async function mintTo(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  hostUsername: string,
  gameIdBytes: Uint8Array,
  playerUsername: string,
  playerAta: Address,
  amount: bigint,
) {
  const mintInstruction = await getMintToPlayerInstructionAsync({
    admin,
    username: hostUsername,
    gameId: gameIdBytes,
    playerUsername,
    playerAta,
    amount,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, mintInstruction);
}

async function transferAdmin(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  username: string,
  gameIdBytes: Uint8Array,
  playerUsername: string,
  playerAta: Address,
) {
  const instruction = await getTransferGameAdminInstructionAsync({
    admin,
    username,
    gameId: gameIdBytes,
    playerUsername,
    playerAta,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, instruction);
}

function accountDataLength(data: unknown): number {
  if (data instanceof Uint8Array) return data.length;
  if (Array.isArray(data) && typeof data[0] === "string") {
    return Buffer.from(data[0], "base64").length;
  }
  throw new Error("unexpected account data encoding");
}

async function gameAccountLength(rpc: Rpc<SolanaRpcApi>, address: Address): Promise<number> {
  const { value } = await rpc.getAccountInfo(address).send();
  if (!value) throw new Error("game account missing");
  return accountDataLength(value.data);
}

describe("transfer_game_admin instruction", () => {
  it("overwrites Game.admin and leaves balances, player count, and size unchanged", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const hostUsername = "xferhost1";
    const playerUsername = "xferplayer1";
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, hostUsername, 241);
    const game = await fetchGame(rpc, gameAddress);
    const sizeBefore = await gameAccountLength(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      playerUsername,
    );
    const { userAddress: hostUser, playerAta: hostAta } = await derivedAta(
      admin,
      hostUsername,
      game.data.mint,
    );
    await mintTo(rpc, rpcSubscriptions, admin, hostUsername, id, playerUsername, playerAta, 500n);
    await mintTo(rpc, rpcSubscriptions, admin, hostUsername, id, hostUsername, hostAta, 200n);

    const before = await fetchGame(rpc, gameAddress);
    expect(before.data.playerCount).toBe(2);
    expect(before.data.admin).toBe(hostUser);

    await transferAdmin(rpc, rpcSubscriptions, admin, hostUsername, id, playerUsername, playerAta);

    const [playerUser] = await findUserPda({ username: playerUsername, admin: admin.address });
    const after = await fetchGame(rpc, gameAddress);
    expect(after.address).toBe(gameAddress);
    expect(after.data.admin).toBe(playerUser);
    expect(after.data.admin).not.toBe(admin.address);
    expect(after.data.playerCount).toBe(2);
    expect(await gameAccountLength(rpc, gameAddress)).toBe(sizeBefore);
    expect((await fetchToken(rpc, playerAta)).data.amount).toBe(500n);
    expect((await fetchToken(rpc, hostAta)).data.amount).toBe(200n);
  }, 30_000);

  it("accepts a zero-balance player and leaves that balance at zero", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "xferhost2", 242);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta, userAddress } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "xferplayer2",
    );

    await transferAdmin(rpc, rpcSubscriptions, admin, "xferhost2", id, "xferplayer2", playerAta);

    const after = await fetchGame(rpc, gameAddress);
    expect(after.data.admin).toBe(userAddress);
    expect(after.data.playerCount).toBe(2);
    expect((await fetchToken(rpc, playerAta)).data.amount).toBe(0n);
  }, 30_000);

  it("rejects a non-admin caller with NotGameAdmin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "xferhost3", 243);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "xferplayer3",
    );
    await joinedPlayer(rpc, rpcSubscriptions, admin, id, game.data.mint, "xferother3");
    const [hostUser] = await findUserPda({ username: "xferhost3", admin: admin.address });

    const instruction = await getTransferGameAdminInstructionAsync({
      admin,
      username: "xferother3",
      gameId: id,
      playerUsername: "xferplayer3",
      playerAta,
    });
    await expectProgramError(
      rpc,
      rpcSubscriptions,
      admin,
      instruction,
      GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
    );

    expect((await fetchGame(rpc, gameAddress)).data.admin).toBe(hostUser);
  }, 30_000);

  it("rejects a non-member with PlayerNotInGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "xferhost4", 244);
    const game = await fetchGame(rpc, gameAddress);
    await registeredAdmin(rpc, rpcSubscriptions, admin, "xfernomember4");
    const { playerAta } = await derivedAta(admin, "xfernomember4", game.data.mint);
    const [hostUser] = await findUserPda({ username: "xferhost4", admin: admin.address });

    const instruction = await getTransferGameAdminInstructionAsync({
      admin,
      username: "xferhost4",
      gameId: id,
      playerUsername: "xfernomember4",
      playerAta,
    });
    await expectProgramError(
      rpc,
      rpcSubscriptions,
      admin,
      instruction,
      GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
    );

    expect((await fetchGame(rpc, gameAddress)).data.admin).toBe(hostUser);
  }, 30_000);

  it("rejects a token account that is not the target ATA with InvalidPlayerAta", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "xferhost5", 245);
    const game = await fetchGame(rpc, gameAddress);
    await joinedPlayer(rpc, rpcSubscriptions, admin, id, game.data.mint, "xferplayer5");
    const { playerAta: hostAta } = await derivedAta(admin, "xferhost5", game.data.mint);
    const [hostUser] = await findUserPda({ username: "xferhost5", admin: admin.address });

    const instruction = await getTransferGameAdminInstructionAsync({
      admin,
      username: "xferhost5",
      gameId: id,
      playerUsername: "xferplayer5",
      playerAta: hostAta,
    });
    await expectProgramError(
      rpc,
      rpcSubscriptions,
      admin,
      instruction,
      GAME_TOKEN_WALLET_ERROR__INVALID_PLAYER_ATA,
    );

    expect((await fetchGame(rpc, gameAddress)).data.admin).toBe(hostUser);
  }, 30_000);

  it("rejects a self-transfer with CannotTransferAdminToSelf and changes nothing", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "xferhost6", 246);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "xferplayer6",
    );
    const { userAddress: hostUser, playerAta: hostAta } = await derivedAta(
      admin,
      "xferhost6",
      game.data.mint,
    );
    await mintTo(rpc, rpcSubscriptions, admin, "xferhost6", id, "xferplayer6", playerAta, 500n);
    await mintTo(rpc, rpcSubscriptions, admin, "xferhost6", id, "xferhost6", hostAta, 200n);

    const instruction = await getTransferGameAdminInstructionAsync({
      admin,
      username: "xferhost6",
      gameId: id,
      playerUsername: "xferhost6",
      playerAta: hostAta,
    });
    await expectProgramError(
      rpc,
      rpcSubscriptions,
      admin,
      instruction,
      GAME_TOKEN_WALLET_ERROR__CANNOT_TRANSFER_ADMIN_TO_SELF,
    );

    const after = await fetchGame(rpc, gameAddress);
    expect(after.data.admin).toBe(hostUser);
    expect(after.data.playerCount).toBe(2);
    expect((await fetchToken(rpc, playerAta)).data.amount).toBe(500n);
    expect((await fetchToken(rpc, hostAta)).data.amount).toBe(200n);
  }, 30_000);

  it("writes nothing when the game account does not exist", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    await registeredAdmin(rpc, rpcSubscriptions, admin, "xfermissing7a");
    await registeredAdmin(rpc, rpcSubscriptions, admin, "xfermissing7b");
    const id = gameId(247);
    const [gameAddress] = await findGamePda({ gameId: id });

    const instruction = await getTransferGameAdminInstructionAsync({
      admin,
      username: "xfermissing7a",
      gameId: id,
      playerUsername: "xfermissing7b",
      playerAta: admin.address,
    });
    // The `game` account was never created, so Anchor rejects it as
    // AccountNotInitialized (custom program error 3012) before the handler runs.
    const ANCHOR_ERROR_ACCOUNT_NOT_INITIALIZED = 3012;
    let cause: unknown;
    try {
      await buildAndSend(rpc, rpcSubscriptions, admin, instruction);
    } catch (error) {
      cause = unwrapSimulationError(error);
    }
    expect(isSolanaError(cause, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)).toBe(true);
    if (isSolanaError(cause, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
      expect(cause.context.code).toBe(ANCHOR_ERROR_ACCOUNT_NOT_INITIALIZED);
    }

    const maybe = await fetchMaybeGame(rpc, gameAddress);
    expect(maybe.exists).toBe(false);
  }, 30_000);

  it("lets the former admin quit and rejects quit from the new admin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const hostUsername = "xferhost8";
    const playerUsername = "xferplayer8";
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, hostUsername, 248);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      playerUsername,
    );
    const { playerAta: hostAta } = await derivedAta(admin, hostUsername, game.data.mint);
    await mintTo(rpc, rpcSubscriptions, admin, hostUsername, id, playerUsername, playerAta, 500n);
    await mintTo(rpc, rpcSubscriptions, admin, hostUsername, id, hostUsername, hostAta, 200n);
    await transferAdmin(rpc, rpcSubscriptions, admin, hostUsername, id, playerUsername, playerAta);

    const quitInstruction = await getQuitGameInstructionAsync({
      admin,
      username: hostUsername,
      gameId: id,
      playerAta: hostAta,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, quitInstruction);
    expect((await rpc.getAccountInfo(hostAta).send()).value).toBeNull();
    expect((await fetchGame(rpc, gameAddress)).data.playerCount).toBe(1);

    const newAdminQuit = await getQuitGameInstructionAsync({
      admin,
      username: playerUsername,
      gameId: id,
      playerAta,
    });
    await expectProgramError(
      rpc,
      rpcSubscriptions,
      admin,
      newAdminQuit,
      GAME_TOKEN_WALLET_ERROR__ADMIN_CANNOT_QUIT_GAME,
    );
    expect((await rpc.getAccountInfo(playerAta).send()).value).not.toBeNull();
    expect((await fetchToken(rpc, playerAta)).data.amount).toBe(500n);
    expect((await fetchGame(rpc, gameAddress)).data.playerCount).toBe(1);
  }, 30_000);

  it("moves mint authority to the new admin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const hostUsername = "xferhost9";
    const playerUsername = "xferplayer9";
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, hostUsername, 249);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      playerUsername,
    );
    const { playerAta: hostAta } = await derivedAta(admin, hostUsername, game.data.mint);
    await mintTo(rpc, rpcSubscriptions, admin, hostUsername, id, hostUsername, hostAta, 200n);
    await transferAdmin(rpc, rpcSubscriptions, admin, hostUsername, id, playerUsername, playerAta);

    const formerMint = await getMintToPlayerInstructionAsync({
      admin,
      username: hostUsername,
      gameId: id,
      playerUsername,
      playerAta,
      amount: 50n,
    });
    await expectProgramError(
      rpc,
      rpcSubscriptions,
      admin,
      formerMint,
      GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
    );
    expect((await fetchToken(rpc, playerAta)).data.amount).toBe(0n);

    const newMint = await getMintToPlayerInstructionAsync({
      admin,
      username: playerUsername,
      gameId: id,
      playerUsername: hostUsername,
      playerAta: hostAta,
      amount: 100n,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, newMint);
    expect((await fetchToken(rpc, hostAta)).data.amount).toBe(300n);
    expect((await fetchGame(rpc, gameAddress)).data.playerCount).toBe(2);
  }, 30_000);

  it("moves close authorization to the new admin without treating them as NotGameAdmin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const hostUsername = "xferhost10";
    const playerUsername = "xferplayer10";
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, hostUsername, 250);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      playerUsername,
    );
    await transferAdmin(rpc, rpcSubscriptions, admin, hostUsername, id, playerUsername, playerAta);

    const formerClose = await getCloseGameInstructionAsync({
      admin,
      username: hostUsername,
      gameId: id,
    });
    await expectProgramError(
      rpc,
      rpcSubscriptions,
      admin,
      formerClose,
      GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
    );
    expect((await rpc.getAccountInfo(gameAddress).send()).value).not.toBeNull();

    const newClose = await getCloseGameInstructionAsync({
      admin,
      username: playerUsername,
      gameId: id,
    });
    await expectProgramError(
      rpc,
      rpcSubscriptions,
      admin,
      newClose,
      GAME_TOKEN_WALLET_ERROR__GAME_NOT_EMPTY,
    );
    expect((await rpc.getAccountInfo(gameAddress).send()).value).not.toBeNull();
    const after = await fetchGame(rpc, gameAddress);
    const [playerUser] = await findUserPda({ username: playerUsername, admin: admin.address });
    expect(after.data.admin).toBe(playerUser);
  }, 30_000);

  it("follows a chained transfer and rejects the original admin afterwards", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const hostUsername = "xferchaina";
    const midUsername = "xferchainb";
    const lastUsername = "xferchainc";
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, hostUsername, 251);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta: midAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      midUsername,
    );
    const { playerAta: lastAta, userAddress: lastUser } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      lastUsername,
    );

    await transferAdmin(rpc, rpcSubscriptions, admin, hostUsername, id, midUsername, midAta);
    const [midUser] = await findUserPda({ username: midUsername, admin: admin.address });
    expect((await fetchGame(rpc, gameAddress)).data.admin).toBe(midUser);

    await transferAdmin(rpc, rpcSubscriptions, admin, midUsername, id, lastUsername, lastAta);
    expect((await fetchGame(rpc, gameAddress)).data.admin).toBe(lastUser);

    const stale = await getTransferGameAdminInstructionAsync({
      admin,
      username: hostUsername,
      gameId: id,
      playerUsername: midUsername,
      playerAta: midAta,
    });
    await expectProgramError(
      rpc,
      rpcSubscriptions,
      admin,
      stale,
      GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
    );
    expect((await fetchGame(rpc, gameAddress)).data.admin).toBe(lastUser);
  }, 60_000);

  it("rejects a transfer to a player who already quit with PlayerNotInGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const hostUsername = "xferquithost";
    const playerUsername = "xferquitwho";
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, hostUsername, 252);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      playerUsername,
    );
    const quitInstruction = await getQuitGameInstructionAsync({
      admin,
      username: playerUsername,
      gameId: id,
      playerAta,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, quitInstruction);
    expect((await rpc.getAccountInfo(playerAta).send()).value).toBeNull();

    const instruction = await getTransferGameAdminInstructionAsync({
      admin,
      username: hostUsername,
      gameId: id,
      playerUsername,
      playerAta,
    });
    await expectProgramError(
      rpc,
      rpcSubscriptions,
      admin,
      instruction,
      GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
    );
    const [hostUser] = await findUserPda({ username: hostUsername, admin: admin.address });
    expect((await fetchGame(rpc, gameAddress)).data.admin).toBe(hostUser);
  }, 30_000);

  it("rejects the target's ATA from a different game with InvalidPlayerAta", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const hostUsername = "xferatahost";
    const playerUsername = "xferataplayer";
    const { id, gameAddress } = await createdGame(
      rpc,
      rpcSubscriptions,
      admin,
      hostUsername,
      253,
      "Transfer Ata One",
    );
    const game = await fetchGame(rpc, gameAddress);
    await joinedPlayer(rpc, rpcSubscriptions, admin, id, game.data.mint, playerUsername);

    const otherId = gameId(254);
    const createOther = await getCreateGameInstructionAsync({
      admin,
      username: hostUsername,
      gameId: otherId,
      name: "Transfer Ata Two",
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, createOther);
    const [otherGameAddress] = await findGamePda({ gameId: otherId });
    const otherGame = await fetchGame(rpc, otherGameAddress);
    const { playerAta: otherAta } = await joinExistingPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      otherId,
      otherGame.data.mint,
      playerUsername,
    );

    const instruction = await getTransferGameAdminInstructionAsync({
      admin,
      username: hostUsername,
      gameId: id,
      playerUsername,
      playerAta: otherAta,
    });
    await expectProgramError(
      rpc,
      rpcSubscriptions,
      admin,
      instruction,
      GAME_TOKEN_WALLET_ERROR__INVALID_PLAYER_ATA,
    );
    const [hostUser] = await findUserPda({ username: hostUsername, admin: admin.address });
    expect((await fetchGame(rpc, gameAddress)).data.admin).toBe(hostUser);
  }, 60_000);
});
