import {
  signTransactionMessageWithSigners,
  assertIsTransactionWithBlockhashLifetime,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import type { SolanaContext } from "./connection";

// `signTransactionMessageWithSigners` returns the non-generic `TransactionWithLifetime`
// (blockhash-or-nonce union) rather than preserving the blockhash-specific lifetime the
// caller set on the message, so narrow it back with the library's own assertion before
// handing it to `sendAndConfirmTransaction`, which requires a blockhash-lifetime
// transaction.
export async function signAndSendTransaction(
  transactionMessage: Parameters<typeof signTransactionMessageWithSigners>[0],
  context: Pick<SolanaContext, "rpc" | "rpcSubscriptions">,
): Promise<void> {
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
    rpc: context.rpc,
    rpcSubscriptions: context.rpcSubscriptions,
  });
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
}
