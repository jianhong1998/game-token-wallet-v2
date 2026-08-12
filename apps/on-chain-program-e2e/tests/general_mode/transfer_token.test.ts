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
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  fetchToken,
  TOKEN_PROGRAM_ADDRESS,
  TOKEN_ERROR__INSUFFICIENT_FUNDS,
} from "@solana-program/token";
import {
  getCreateUserInstructionAsync,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
  getMintToPlayerInstructionAsync,
  getTransferTokenInstructionAsync,
  findGamePda,
  findUserPda,
  fetchGame,
  GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
  GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT,
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

// Registers `username` under an already-funded, shared `admin` — required
// because `transfer_token`'s `sender`/`recipient` PDAs are both seeded off
// the SAME `admin.key()` (see the note above this task's Step 1).
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
    name: "Transfer Test Game",
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
  return { userAddress, playerAta };
}

async function fundedPlayer(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  gameIdBytes: Uint8Array,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
  hostUsername: string,
  username: string,
  amount: bigint,
) {
  const { playerAta } = await joinedPlayer(rpc, rpcSubscriptions, admin, gameIdBytes, mint, username);
  const mintInstruction = await getMintToPlayerInstructionAsync({
    admin,
    username: hostUsername,
    gameId: gameIdBytes,
    playerUsername: username,
    playerAta,
    amount,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, mintInstruction);
  return { playerAta };
}

describe("transfer_token instruction", () => {
  it("moves tokens from the sender's ATA to the recipient's ATA", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "transferhost1", 301);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta: senderAta } = await fundedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferhost1",
      "transfersender1",
      1000n,
    );
    const { playerAta: recipientAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferrecipient1",
    );

    const transferInstruction = await getTransferTokenInstructionAsync({
      admin,
      gameId: id,
      senderUsername: "transfersender1",
      recipientUsername: "transferrecipient1",
      senderAta,
      recipientAta,
      amount: 300n,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, transferInstruction);

    const senderToken = await fetchToken(rpc, senderAta);
    const recipientToken = await fetchToken(rpc, recipientAta);
    expect(senderToken.data.amount).toBe(700n);
    expect(recipientToken.data.amount).toBe(300n);
  }, 30_000);

  it("rejects a self-transfer with SelfTransfer", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "transferhost2", 302);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await fundedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferhost2",
      "transferself2",
      500n,
    );

    const transferInstruction = await getTransferTokenInstructionAsync({
      admin,
      gameId: id,
      senderUsername: "transferself2",
      recipientUsername: "transferself2",
      senderAta: playerAta,
      recipientAta: playerAta,
      amount: 100n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the self-transfer to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__SELF_TRANSFER,
        ),
      ).toBe(true);
    }

    const token = await fetchToken(rpc, playerAta);
    expect(token.data.amount).toBe(500n);
  }, 30_000);

  it("rejects a transfer to a non-member with PlayerNotInGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "transferhost3", 303);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta: senderAta } = await fundedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferhost3",
      "transfersender3",
      500n,
    );
    // Registered (under the same shared admin) but never joined — no ATA exists yet.
    const nonMemberUsername = "transfernonmember3";
    await registeredAdmin(rpc, rpcSubscriptions, admin, nonMemberUsername);
    const [nonMemberUserAddress] = await findUserPda({ username: nonMemberUsername, admin: admin.address });
    const [nonMemberAta] = await findAssociatedTokenPda({
      owner: nonMemberUserAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const transferInstruction = await getTransferTokenInstructionAsync({
      admin,
      gameId: id,
      senderUsername: "transfersender3",
      recipientUsername: nonMemberUsername,
      senderAta,
      recipientAta: nonMemberAta,
      amount: 100n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the transfer to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
        ),
      ).toBe(true);
    }

    const senderToken = await fetchToken(rpc, senderAta);
    expect(senderToken.data.amount).toBe(500n);
  }, 30_000);

  it("rejects a zero amount with InvalidTransferAmount", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "transferhost4", 304);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta: senderAta } = await fundedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferhost4",
      "transfersender4",
      500n,
    );
    const { playerAta: recipientAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferrecipient4",
    );

    const transferInstruction = await getTransferTokenInstructionAsync({
      admin,
      gameId: id,
      senderUsername: "transfersender4",
      recipientUsername: "transferrecipient4",
      senderAta,
      recipientAta,
      amount: 0n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the transfer to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__INVALID_TRANSFER_AMOUNT,
        ),
      ).toBe(true);
    }

    const senderToken = await fetchToken(rpc, senderAta);
    const recipientToken = await fetchToken(rpc, recipientAta);
    expect(senderToken.data.amount).toBe(500n);
    expect(recipientToken.data.amount).toBe(0n);
  }, 30_000);

  it("rejects a transfer exceeding the sender's balance via the SPL token program's native error", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "transferhost5", 305);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta: senderAta } = await fundedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferhost5",
      "transfersender5",
      100n,
    );
    const { playerAta: recipientAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "transferrecipient5",
    );

    const transferInstruction = await getTransferTokenInstructionAsync({
      admin,
      gameId: id,
      senderUsername: "transfersender5",
      recipientUsername: "transferrecipient5",
      senderAta,
      recipientAta,
      amount: 500n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([transferInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the transfer to be rejected");
    } catch (error) {
      // `transfer_token` CPIs into the SPL Token program's own `transfer`
      // instruction, so the RPC's returned custom-error `index` still names
      // our own top-level `transfer_token` instruction (whose program is
      // `game_token_wallet`, not the token program) — `isTokenError`'s
      // program-address check can never match a CPI'd error, regardless of
      // which code fired. Assert the underlying SPL Token error code
      // directly instead of via `isTokenError`.
      const unwrapped = unwrapSimulationError(error);
      expect(isSolanaError(unwrapped, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)).toBe(true);
      if (isSolanaError(unwrapped, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
        expect(unwrapped.context.code).toBe(TOKEN_ERROR__INSUFFICIENT_FUNDS);
      }
    }

    const senderToken = await fetchToken(rpc, senderAta);
    const recipientToken = await fetchToken(rpc, recipientAta);
    expect(senderToken.data.amount).toBe(100n);
    expect(recipientToken.data.amount).toBe(0n);
  }, 30_000);
});
