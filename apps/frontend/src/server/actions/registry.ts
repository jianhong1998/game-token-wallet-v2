"use server";

import {
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit";
import { fetchMaybeRegistry, findRegistryPda, getInitializeRegistryInstructionAsync } from "on-chain-client";
import { getSolanaContext } from "../connection";

export async function initializeRegistry(): Promise<{ activeGameCount: number }> {
  const { rpc, rpcSubscriptions, adminSigner, programAddress } = await getSolanaContext();

  const [registryAddress] = await findRegistryPda({ programAddress });

  const existing = await fetchMaybeRegistry(rpc, registryAddress);
  if (existing.exists) {
    return { activeGameCount: existing.data.activeGames.length };
  }

  const initializeInstruction = await getInitializeRegistryInstructionAsync(
    { admin: adminSigner, registry: registryAddress },
    { programAddress },
  );

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(adminSigner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([initializeInstruction], tx),
  );

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  // See apps/frontend/src/server/actions/noop.ts for why this assertion is needed.
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  try {
    await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
  } catch (error) {
    // Concurrent caller may have initialized it first between our read and
    // our send — re-check rather than surfacing a scary error for what is,
    // from the caller's perspective, still a successful outcome.
    const raced = await fetchMaybeRegistry(rpc, registryAddress);
    if (raced.exists) {
      return { activeGameCount: raced.data.activeGames.length };
    }
    throw error;
  }

  return { activeGameCount: 0 };
}
