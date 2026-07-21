import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  airdropFactory,
  getSignatureFromTransaction,
  lamports,
  assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit";
import { getNoopInstruction, GAME_TOKEN_WALLET_PROGRAM_ADDRESS } from "on-chain-client";

const RPC_URL = "http://127.0.0.1:8899";
const RPC_WS_URL = "ws://127.0.0.1:8900";

describe("noop instruction round trip", () => {
  it("confirms on the local validator through the generated on-chain-client", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);

    const keypairPath = join(homedir(), ".config", "solana", "id.json");
    const secretKeyBytes = new Uint8Array(JSON.parse(readFileSync(keypairPath, "utf-8")));
    const payer = await createKeyPairSignerFromBytes(secretKeyBytes);

    const airdrop = airdropFactory({ rpc, rpcSubscriptions });
    await airdrop({
      commitment: "confirmed",
      recipientAddress: payer.address,
      lamports: lamports(1_000_000_000n),
    });

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const noopInstruction = getNoopInstruction({
      programAddress: GAME_TOKEN_WALLET_PROGRAM_ADDRESS,
    });

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([noopInstruction], tx),
    );

    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    // `signTransactionMessageWithSigners` returns the non-generic `TransactionWithLifetime`
    // (blockhash-or-nonce union) rather than preserving the blockhash-specific lifetime we set
    // above, so narrow it back with the library's own assertion before handing it to
    // `sendAndConfirmTransaction`, which requires a blockhash-lifetime transaction.
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    await expect(
      sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" }),
    ).resolves.not.toThrow();

    expect(getSignatureFromTransaction(signedTransaction)).toMatch(
      /^[1-9A-HJ-NP-Za-km-z]{64,88}$/,
    );
  }, 30_000);
});
