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

describe("initialize_registry instruction", () => {
  it("creates the Registry account with an empty active-games list, and rejects a second call cleanly", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await generateKeyPairSigner();

    const airdrop = airdropFactory({ rpc, rpcSubscriptions });
    await airdrop({
      commitment: "confirmed",
      recipientAddress: admin.address,
      lamports: lamports(1_000_000_000n),
    });

    await sendInitializeRegistry(rpc, rpcSubscriptions, admin);

    const [registryAddress] = await findRegistryPda();
    const registryAccount = await fetchRegistry(rpc, registryAddress);
    expect(registryAccount.data.activeGames).toEqual([]);

    await expect(sendInitializeRegistry(rpc, rpcSubscriptions, admin)).rejects.toThrow();
  }, 30_000);
});
