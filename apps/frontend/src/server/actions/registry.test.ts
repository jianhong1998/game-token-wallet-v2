import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MaybeAccount } from "@solana/kit";
import type { Registry } from "on-chain-client";

const { mockGetSolanaContext } = vi.hoisted(() => ({
  mockGetSolanaContext: vi.fn(),
}));
vi.mock("../connection", () => ({
  getSolanaContext: mockGetSolanaContext,
}));

const { mockFindRegistryPda, mockFetchMaybeRegistry, mockGetInitializeRegistryInstructionAsync } = vi.hoisted(
  () => ({
    mockFindRegistryPda: vi.fn(),
    mockFetchMaybeRegistry: vi.fn(),
    mockGetInitializeRegistryInstructionAsync: vi.fn(),
  }),
);
vi.mock("on-chain-client", () => ({
  findRegistryPda: mockFindRegistryPda,
  fetchMaybeRegistry: mockFetchMaybeRegistry,
  getInitializeRegistryInstructionAsync: mockGetInitializeRegistryInstructionAsync,
}));

const { mockSignTransactionMessageWithSigners, mockSendAndConfirmTransaction } = vi.hoisted(() => ({
  mockSignTransactionMessageWithSigners: vi.fn(),
  mockSendAndConfirmTransaction: vi.fn(),
}));
vi.mock("@solana/kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/kit")>();
  return {
    ...actual,
    signTransactionMessageWithSigners: mockSignTransactionMessageWithSigners,
    assertIsTransactionWithBlockhashLifetime: vi.fn(),
    sendAndConfirmTransactionFactory: () => mockSendAndConfirmTransaction,
  };
});

import { initializeRegistry } from "./registry";

const REGISTRY_ADDRESS = "Regi11111111111111111111111111111111111111";

function registryData(activeGames: string[]): Registry {
  return {
    discriminator: new Uint8Array(8),
    bump: 255,
    activeGames: activeGames as Registry["activeGames"],
  };
}

describe("initializeRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSolanaContext.mockResolvedValue({
      rpc: {
        getLatestBlockhash: () => ({
          send: async () => ({ value: { blockhash: "fake", lastValidBlockHeight: 1n } }),
        }),
      },
      rpcSubscriptions: {},
      adminSigner: { address: "Admin111111111111111111111111111111111111" },
      programAddress: "Prog1111111111111111111111111111111111111",
    });
    mockFindRegistryPda.mockResolvedValue([REGISTRY_ADDRESS, 255]);
    mockGetInitializeRegistryInstructionAsync.mockResolvedValue({
      programAddress: "Prog1111111111111111111111111111111111111",
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignTransactionMessageWithSigners.mockResolvedValue({});
    mockSendAndConfirmTransaction.mockResolvedValue(undefined);
  });

  it("returns the existing active game count without sending a transaction when the registry already exists", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: registryData(["Game1111111111111111111111111111111111111"]),
    } as MaybeAccount<Registry>);

    const result = await initializeRegistry();

    expect(result).toEqual({ activeGameCount: 1 });
    expect(mockSendAndConfirmTransaction).not.toHaveBeenCalled();
    // Regression guard: the registry PDA must be derived against the
    // env-configured program address (getSolanaContext), never the
    // codegen-baked default — see apps/frontend/src/server/actions/noop.ts.
    expect(mockFindRegistryPda).toHaveBeenCalledWith({
      programAddress: "Prog1111111111111111111111111111111111111",
    });
  });

  it("sends the init transaction and returns zero active games when the registry does not yet exist", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({ exists: false, address: REGISTRY_ADDRESS } as MaybeAccount<Registry>);

    const result = await initializeRegistry();

    expect(result).toEqual({ activeGameCount: 0 });
    expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
    expect(mockGetInitializeRegistryInstructionAsync).toHaveBeenCalledWith(
      { admin: { address: "Admin111111111111111111111111111111111111" } },
      { programAddress: "Prog1111111111111111111111111111111111111" },
    );
  });

  it("recovers by re-fetching when the init transaction races and the account already exists", async () => {
    mockFetchMaybeRegistry
      .mockResolvedValueOnce({ exists: false, address: REGISTRY_ADDRESS } as MaybeAccount<Registry>)
      .mockResolvedValueOnce({
        exists: true,
        address: REGISTRY_ADDRESS,
        data: registryData([]),
      } as MaybeAccount<Registry>);
    mockSendAndConfirmTransaction.mockRejectedValueOnce(new Error("already in use"));

    const result = await initializeRegistry();

    expect(result).toEqual({ activeGameCount: 0 });
    expect(mockFetchMaybeRegistry).toHaveBeenCalledTimes(2);
  });
});
