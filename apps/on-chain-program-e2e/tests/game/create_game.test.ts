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
import { fetchMint, fetchToken, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getCreateUserInstructionAsync,
  getCreateGameInstructionAsync,
  findGamePda,
  findUserPda,
  fetchGame,
  findRegistryPda,
  fetchRegistry,
  GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH,
  GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_CHARACTERS,
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

// Typed against each instruction builder's own return type (rather than one
// shared `Instruction`-typed helper) to match this file's neighbors
// (create_user.test.ts, registry/initialize.test.ts), which don't share a
// generic send helper across different instruction builders either.
async function sendCreateUserInstruction(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  instruction: Awaited<ReturnType<typeof getCreateUserInstructionAsync>>,
): Promise<void> {
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
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
}

async function sendCreateGameInstruction(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  instruction: Awaited<ReturnType<typeof getCreateGameInstructionAsync>>,
): Promise<void> {
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
  await sendCreateUserInstruction(rpc, rpcSubscriptions, admin, createUserInstruction);
  return admin;
}

// `fill` only disambiguates call sites for a human reading a single test
// run; the remaining bytes are randomized so the resulting Game PDA is
// unique across repeated `just test-e2e-program` invocations against the
// same persistent validator (no `just down-clean` in between) — otherwise a
// second run's `create_game` for the same fixed id would hit the same
// "account already in use" class of failure that global-setup.ts's registry
// init used to (see tests/global-setup.ts).
function gameId(fill: number): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = fill;
  return bytes;
}

describe("create_game instruction", () => {
  it("creates the Game account, its mint, and appends it to the registry", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await registeredAdmin(rpc, rpcSubscriptions, "gamehost1");
    const id = gameId(1);

    const instruction = await getCreateGameInstructionAsync({
      admin,
      username: "gamehost1",
      gameId: id,
      name: "Friday Poker",
    });
    await sendCreateGameInstruction(rpc, rpcSubscriptions, admin, instruction);

    const [gameAddress] = await findGamePda({ gameId: id });
    const game = await fetchGame(rpc, gameAddress);
    expect(game.data.name).toBe("Friday Poker");
    expect(new Uint8Array(game.data.gameId)).toEqual(id);

    const [registryAddress] = await findRegistryPda();
    const registry = await fetchRegistry(rpc, registryAddress);
    expect(registry.data.activeGames).toContain(gameAddress);

    const mint = await fetchMint(rpc, game.data.mint);
    expect(mint.data.decimals).toBe(2);
    expect(mint.data.mintAuthority).toEqual({ __option: "Some", value: gameAddress });

    expect(game.data.playerCount).toBe(1);

    const [userAddress] = await findUserPda({ username: "gamehost1", admin: admin.address });
    const [playerAta] = await findAssociatedTokenPda({
      owner: userAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const token = await fetchToken(rpc, playerAta);
    expect(token.data.owner).toBe(userAddress);
    expect(token.data.amount).toBe(0n);
  }, 30_000);

  it("rejects a game name shorter than 3 bytes with InvalidGameNameLength", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await registeredAdmin(rpc, rpcSubscriptions, "gamehost2");

    const instruction = await getCreateGameInstructionAsync({
      admin,
      username: "gamehost2",
      gameId: gameId(2),
      name: "ab",
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
      expect.fail("expected transaction to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH,
        ),
      ).toBe(true);
    }
  }, 30_000);

  it("rejects a game name over 32 bytes with InvalidGameNameLength", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await registeredAdmin(rpc, rpcSubscriptions, "gamehost3");

    const instruction = await getCreateGameInstructionAsync({
      admin,
      username: "gamehost3",
      gameId: gameId(3),
      name: "a".repeat(33),
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
      expect.fail("expected transaction to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH,
        ),
      ).toBe(true);
    }
  }, 30_000);

  it("rejects a game name containing a disallowed character with InvalidGameNameCharacters", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await registeredAdmin(rpc, rpcSubscriptions, "gamehost4");

    const instruction = await getCreateGameInstructionAsync({
      admin,
      username: "gamehost4",
      gameId: gameId(4),
      name: "Friday!",
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
      expect.fail("expected transaction to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_CHARACTERS,
        ),
      ).toBe(true);
    }
  }, 30_000);
});
