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
import { findAssociatedTokenPda, fetchToken, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getCreateUserInstructionAsync,
  getCreateGameInstructionAsync,
  getJoinGameInstructionAsync,
  getMintToPlayerInstructionAsync,
  findGamePda,
  findUserPda,
  fetchGame,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
  GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT,
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

async function buildAndSend(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  payer: KeyPairSigner,
  instruction: { programAddress: unknown; accounts: unknown; data: unknown },
): Promise<void> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([instruction as never], tx),
  );
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
}

// DEVIATION from the plan's literal test file: `registeredAdmin` here takes
// an already-funded `admin` signer and registers `username` under it,
// instead of minting a brand-new random keypair per username the way the
// plan's snippet (and this repo's other `on-chain-program-e2e` test files)
// do. That per-user-random-admin pattern happens to work for
// create_game/join_game because those instructions only ever resolve ONE
// user's own `User` PDA. `mint_to_player` is different: its single
// `admin: Signer` is used to derive BOTH the caller's `user` PDA AND the
// target's `player_user` PDA (seeds `[b"user", <username>, admin.key()]`
// for each) — see instructions/game/mint_to_player.rs. That only resolves
// correctly if both the depositing admin and the target player were
// registered under the SAME `admin` keypair, which is exactly how
// production works: every transaction is signed by one shared custodial
// system wallet regardless of which end user is acting (see spec.md's
// "Admin identity enforced on-chain" requirement — identity is carried by
// the `username` argument, not by which keypair signs). Using an
// independent random admin per registered user — as the plan's original
// snippet did — breaks that invariant: `player_user` (or, for the
// NotGameAdmin case, `user`) fails Anchor's account-exists check with a raw
// `AccountNotInitialized` (custom program error #3012) before the
// handler's own `NotGameAdmin`/`PlayerNotInGame` logic ever runs. Verified
// empirically: attempt 1 with the plan's original per-user-random-admin
// helpers failed all four scenarios this way.
async function registeredAdmin(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  username: string,
): Promise<void> {
  const createUserInstruction = await getCreateUserInstructionAsync({
    admin,
    username,
    salt: new Uint8Array(16),
    passwordHash: new Uint8Array(64),
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, createUserInstruction);
}

function gameId(fill: number): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = fill;
  return bytes;
}

async function createdGame(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  hostUsername: string,
  idFill: number,
) {
  await registeredAdmin(rpc, rpcSubscriptions, admin, hostUsername);
  const id = gameId(idFill);
  const createGameInstruction = await getCreateGameInstructionAsync({
    admin,
    username: hostUsername,
    gameId: id,
    name: "Deposit Test Game",
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, createGameInstruction);
  const [gameAddress] = await findGamePda({ gameId: id });
  return { id, gameAddress };
}

async function joinedPlayer(
  rpc: Rpc<SolanaRpcApi>,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  admin: KeyPairSigner,
  gameIdBytes: Uint8Array,
  mint: Parameters<typeof findAssociatedTokenPda>[0]["mint"],
  username: string,
) {
  await registeredAdmin(rpc, rpcSubscriptions, admin, username);
  const [userAddress] = await findUserPda({ username, admin: admin.address });
  const [playerAta] = await findAssociatedTokenPda({
    owner: userAddress,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const joinGameInstruction = await getJoinGameInstructionAsync({
    admin,
    username,
    gameId: gameIdBytes,
    playerAta,
  });
  await buildAndSend(rpc, rpcSubscriptions, admin, joinGameInstruction);
  return { userAddress, playerAta };
}

describe("mint_to_player instruction", () => {
  it("mints the amount into the target player's existing ATA", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    // One shared admin signer for host + player — see the DEVIATION note on
    // `registeredAdmin` above for why this must be shared, not per-user.
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "deposithost1", 201);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "depositplayer1",
    );

    const mintInstruction = await getMintToPlayerInstructionAsync({
      admin,
      username: "deposithost1",
      gameId: id,
      playerUsername: "depositplayer1",
      playerAta,
      amount: 500n,
    });
    await buildAndSend(rpc, rpcSubscriptions, admin, mintInstruction);

    const token = await fetchToken(rpc, playerAta);
    expect(token.data.amount).toBe(500n);
  }, 30_000);

  it("rejects a non-admin caller with NotGameAdmin", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    // Same shared admin signer throughout — impersonation here is modeled
    // by passing a different `username` (not the game's real admin), not by
    // signing with a different keypair. That's the actual on-chain threat
    // model this test verifies: every transaction is signed by the same
    // custodial system wallet, so identity is carried by `username` alone
    // (see DEVIATION note on `registeredAdmin`).
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "deposithost2", 202);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "depositplayer2",
    );
    // A second user, registered (under the same shared admin) but not this
    // game's admin.
    await registeredAdmin(rpc, rpcSubscriptions, admin, "depositimpostor2");

    const mintInstruction = await getMintToPlayerInstructionAsync({
      admin,
      username: "depositimpostor2",
      gameId: id,
      playerUsername: "depositplayer2",
      playerAta,
      amount: 500n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([mintInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the deposit to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN,
        ),
      ).toBe(true);
    }

    const token = await fetchToken(rpc, playerAta);
    expect(token.data.amount).toBe(0n);
  }, 30_000);

  it("rejects a deposit to a non-member with PlayerNotInGame", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id } = await createdGame(rpc, rpcSubscriptions, admin, "deposithost3", 203);
    // Registered (under the same shared admin) but never joined to the
    // game — no ATA exists yet.
    const nonMemberUsername = "depositnonmember3";
    await registeredAdmin(rpc, rpcSubscriptions, admin, nonMemberUsername);
    const [nonMemberUserAddress] = await findUserPda({
      username: nonMemberUsername,
      admin: admin.address,
    });
    const game = await fetchGame(rpc, (await findGamePda({ gameId: id }))[0]);
    const [nonMemberAta] = await findAssociatedTokenPda({
      owner: nonMemberUserAddress,
      mint: game.data.mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const mintInstruction = await getMintToPlayerInstructionAsync({
      admin,
      username: "deposithost3",
      gameId: id,
      playerUsername: nonMemberUsername,
      playerAta: nonMemberAta,
      amount: 500n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([mintInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the deposit to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME,
        ),
      ).toBe(true);
    }
  }, 30_000);

  it("rejects a zero amount with InvalidDepositAmount", async () => {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const admin = await fundedAdmin(rpc, rpcSubscriptions);
    const { id, gameAddress } = await createdGame(rpc, rpcSubscriptions, admin, "deposithost4", 204);
    const game = await fetchGame(rpc, gameAddress);
    const { playerAta } = await joinedPlayer(
      rpc,
      rpcSubscriptions,
      admin,
      id,
      game.data.mint,
      "depositplayer4",
    );

    const mintInstruction = await getMintToPlayerInstructionAsync({
      admin,
      username: "deposithost4",
      gameId: id,
      playerUsername: "depositplayer4",
      playerAta,
      amount: 0n,
    });
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(admin, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([mintInstruction], tx),
    );
    const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

    try {
      await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
      expect.fail("expected the deposit to be rejected");
    } catch (error) {
      expect(
        isGameTokenWalletError(
          unwrapSimulationError(error),
          transactionMessage,
          GAME_TOKEN_WALLET_ERROR__INVALID_DEPOSIT_AMOUNT,
        ),
      ).toBe(true);
    }

    const token = await fetchToken(rpc, playerAta);
    expect(token.data.amount).toBe(0n);
  }, 30_000);
});
