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
import {
  getCreateUserInstructionAsync,
  findUserPda,
  fetchUser,
  GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH,
  isGameTokenWalletError,
} from "on-chain-client";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS_URL = process.env.SOLANA_RPC_WS_URL ?? "ws://127.0.0.1:8900";

interface CreateUserArgs {
  username: string;
  salt: Uint8Array;
  passwordHash: Uint8Array;
}

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

async function sendCreateUser(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  args: CreateUserArgs,
): Promise<void> {
  const instruction = await getCreateUserInstructionAsync({ admin, ...args });
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

describe("create_user instruction", () => {
  it("creates the User account with the given username, salt, and password hash", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const salt = new Uint8Array(16).fill(1);
    const passwordHash = new Uint8Array(64).fill(2);

    await sendCreateUser(rpc, rpcSubscriptions, admin, { username: "alice", salt, passwordHash });

    const [userAddress] = await findUserPda({ username: "alice", admin: admin.address });
    const userAccount = await fetchUser(rpc, userAddress);
    expect(userAccount.data.username).toBe("alice");
    expect(new Uint8Array(userAccount.data.salt)).toEqual(salt);
    expect(new Uint8Array(userAccount.data.passwordHash)).toEqual(passwordHash);
  }, 30_000);

  it("rejects a duplicate username for the same admin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const salt = new Uint8Array(16).fill(1);
    const passwordHash = new Uint8Array(64).fill(2);

    await sendCreateUser(rpc, rpcSubscriptions, admin, { username: "bob", salt, passwordHash });

    await expect(
      sendCreateUser(rpc, rpcSubscriptions, admin, { username: "bob", salt, passwordHash }),
    ).rejects.toThrow();
  }, 30_000);

  it("rejects a username shorter than 3 bytes with InvalidUsernameLength", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const salt = new Uint8Array(16);
    const passwordHash = new Uint8Array(64);

    const instruction = await getCreateUserInstructionAsync({
      admin,
      username: "ab",
      salt,
      passwordHash,
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
          GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH,
        ),
      ).toBe(true);
    }
  }, 30_000);

  it("rejects a username longer than 32 bytes at PDA derivation (Solana's protocol seed-length cap, not the on-chain InvalidUsernameLength error)", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const salt = new Uint8Array(16);
    const passwordHash = new Uint8Array(64);
    const tooLong = "a".repeat(33);

    // A 33-byte username collides with Solana's own MAX_SEED_LEN (32 bytes) for the
    // `user` PDA's seed, which is numerically identical to the program's business-rule
    // MAX_USERNAME_BYTES. Address derivation itself throws synchronously and client-side
    // (inside @solana/addresses' createProgramDerivedAddress, invoked from findUserPda
    // inside getCreateUserInstructionAsync) before any instruction can be built or a
    // transaction sent — so the on-chain InvalidUsernameLength error is unreachable for
    // this case. This test asserts only that the operation is rejected up front, not the
    // specific error code (see 2026-07-24-user-registration-login error log for the
    // architectural writeup).
    await expect(
      getCreateUserInstructionAsync({ admin, username: tooLong, salt, passwordHash }),
    ).rejects.toThrow();
  }, 30_000);
});
