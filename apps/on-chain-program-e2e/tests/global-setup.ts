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
} from "@solana/kit";
import { getInitializeRegistryInstructionAsync, findRegistryPda, fetchMaybeRegistry } from "on-chain-client";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS_URL = process.env.SOLANA_RPC_WS_URL ?? "ws://127.0.0.1:8900";

// Registry is a program-wide singleton PDA (seeds = [b"registry"]); every
// sibling test file's create_game call requires it to already exist, and
// initialize_registry can only ever succeed once per chain. Vitest runs test
// files as separate parallel workers by default with no shared module state
// between them, so ownership of "create the registry exactly once, before
// anything else touches it" can't live inside a regular test in
// tests/registry/initialize.test.ts — a sibling file's create_game call can
// race (or even outrun) that test's file. globalSetup is the one hook Vitest
// guarantees runs to completion, once, in a single process, before any test
// file starts (regardless of file parallelism), so it's the only place that
// can safely own this.
//
// `test-e2e-program` runs `anchor test --skip-local-validator` against a
// persistent docker validator (see justfile), not a fresh one per invocation
// — a second consecutive `just test`/`just test-e2e-program` run (no
// `just down-clean` in between) hits this same globalSetup again against a
// Registry PDA that already exists from the first run. `initialize_registry`
// uses Anchor's `init` constraint (see instructions/registry/initialize.rs),
// which can only ever succeed once per PDA — a second call fails with a raw
// "already in use" system-program error, not a custom ErrorCode. Guard with
// an existence check (the same fetchMaybe*/`.exists` pattern the generated
// on-chain-client uses elsewhere) so repeated runs against the same
// validator state are idempotent instead of hard-failing globalSetup before
// any test executes.
export default async function setup(): Promise<void> {
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);

  const [registryAddress] = await findRegistryPda();
  const maybeRegistry = await fetchMaybeRegistry(rpc, registryAddress);
  if (maybeRegistry.exists) {
    return;
  }

  const admin = await generateKeyPairSigner();

  const airdrop = airdropFactory({ rpc, rpcSubscriptions });
  await airdrop({
    commitment: "confirmed",
    recipientAddress: admin.address,
    lamports: lamports(1_000_000_000n),
  });

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
