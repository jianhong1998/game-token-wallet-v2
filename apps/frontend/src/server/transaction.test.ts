import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSignTransactionMessageWithSigners,
  mockAssertIsTransactionWithBlockhashLifetime,
  mockSendAndConfirmTransaction,
} = vi.hoisted(() => ({
  mockSignTransactionMessageWithSigners: vi.fn(),
  mockAssertIsTransactionWithBlockhashLifetime: vi.fn(),
  mockSendAndConfirmTransaction: vi.fn(),
}));
vi.mock("@solana/kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/kit")>();
  return {
    ...actual,
    signTransactionMessageWithSigners: mockSignTransactionMessageWithSigners,
    assertIsTransactionWithBlockhashLifetime: mockAssertIsTransactionWithBlockhashLifetime,
    sendAndConfirmTransactionFactory: () => mockSendAndConfirmTransaction,
  };
});

import { signAndSendTransaction } from "./transaction";

const FAKE_TRANSACTION_MESSAGE = { instructions: [] } as never;
const RPC = {} as never;
const RPC_SUBSCRIPTIONS = {} as never;

describe("signAndSendTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs, asserts the blockhash lifetime, and sends-and-confirms in order", async () => {
    const signedTransaction = { signatures: {} };
    mockSignTransactionMessageWithSigners.mockResolvedValue(signedTransaction);
    mockSendAndConfirmTransaction.mockResolvedValue(undefined);

    await signAndSendTransaction(FAKE_TRANSACTION_MESSAGE, {
      rpc: RPC,
      rpcSubscriptions: RPC_SUBSCRIPTIONS,
    });

    expect(mockSignTransactionMessageWithSigners).toHaveBeenCalledWith(FAKE_TRANSACTION_MESSAGE);
    expect(mockAssertIsTransactionWithBlockhashLifetime).toHaveBeenCalledWith(signedTransaction);
    expect(mockSendAndConfirmTransaction).toHaveBeenCalledWith(signedTransaction, {
      commitment: "confirmed",
    });
  });

  it("propagates rejection when the transaction's blockhash has expired", async () => {
    mockSignTransactionMessageWithSigners.mockResolvedValue({ signatures: {} });
    mockSendAndConfirmTransaction.mockRejectedValue(new Error("block height exceeded"));

    await expect(
      signAndSendTransaction(FAKE_TRANSACTION_MESSAGE, {
        rpc: RPC,
        rpcSubscriptions: RPC_SUBSCRIPTIONS,
      }),
    ).rejects.toThrow("block height exceeded");
  });
});
