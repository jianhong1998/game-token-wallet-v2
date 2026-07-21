"use server";

import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  createSolanaRpcSubscriptions,
  getSignatureFromTransaction,
  assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit";
import { getNoopInstruction } from "on-chain-client";
import { getSolanaContext } from "../connection";
import { loadSolanaEnv } from "../env";

export async function sendNoopTransaction(): Promise<{ signature: string }> {
  const { rpc, adminSigner, programAddress } = await getSolanaContext();
  const env = loadSolanaEnv();

  // Solana JSON-RPC servers (solana-test-validator, agave-validator,
  // surfpool) serve the WS pub-sub endpoint on a *separate* port —
  // rpc_port + 1 by default (e.g. RPC on 8899, WS on 8900) — not the same
  // port with the protocol swapped. A naive `http` -> `ws` string replace
  // keeps the RPC port and silently fails to connect.
  const rpcUrl = new URL(env.rpcUrl);
  const wsUrl = new URL(rpcUrl);
  wsUrl.protocol = rpcUrl.protocol === "https:" ? "wss:" : "ws:";
  const rpcPort = Number(rpcUrl.port || (rpcUrl.protocol === "https:" ? 443 : 80));
  wsUrl.port = String(rpcPort + 1);

  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl.toString());

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const noopInstruction = getNoopInstruction({ programAddress });

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
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
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });

  return { signature: getSignatureFromTransaction(signedTransaction) };
}
