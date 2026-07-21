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

  const rpcSubscriptions = createSolanaRpcSubscriptions(
    env.rpcUrl.replace(/^http/, "ws"),
  );

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
