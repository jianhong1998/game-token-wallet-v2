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
  type KeyPairSigner,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import { getInitializeRegistryInstructionAsync, findRegistryPda, fetchRegistry } from "on-chain-client";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS_URL = process.env.SOLANA_RPC_WS_URL ?? "ws://127.0.0.1:8900";

async function sendInitializeRegistry(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
): Promise<void> {
  const instruction = await getInitializeRegistryInstructionAsync({ admin });
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

// Registry is a program-wide singleton PDA (seeds = [b"registry"]), created
// once by tests/global-setup.ts before any test file in this suite runs (see
// that file for why: initialize_registry can only ever succeed once per
// chain, and sibling files' create_game calls require the registry to
// already exist). Because it's a singleton shared by every file here —
// concurrently or not — this test does NOT call initialize_registry itself
// and does NOT assert `activeGames` is empty: by the time this test's `it()`
// body runs, sibling files (create_game.test.ts, join_game.test.ts) may have
// already appended entries, so global emptiness is not a stable invariant to
// assert from inside a test file. Instead it asserts the two things that ARE
// true regardless of run order: the singleton exists in a properly
// initialized shape, and a second initialize_registry call is rejected.
describe("initialize_registry instruction", () => {
  it("exposes the Registry singleton that global setup already initialized", async () => {
    const rpc = createSolanaRpc(RPC_URL);

    const [registryAddress] = await findRegistryPda();
    const registryAccount = await fetchRegistry(rpc, registryAddress);

    expect(typeof registryAccount.data.bump).toBe("number");
    expect(Array.isArray(registryAccount.data.activeGames)).toBe(true);
  }, 30_000);

  it("rejects a second initialize_registry call cleanly", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await generateKeyPairSigner();

    const airdrop = airdropFactory({ rpc, rpcSubscriptions });
    await airdrop({
      commitment: "confirmed",
      recipientAddress: admin.address,
      lamports: lamports(1_000_000_000n),
    });

    await expect(sendInitializeRegistry(rpc, rpcSubscriptions, admin)).rejects.toThrow();
  }, 30_000);
});
