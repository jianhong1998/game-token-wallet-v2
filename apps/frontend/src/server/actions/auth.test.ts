import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MaybeAccount } from "@solana/kit";
import type { User } from "on-chain-client";

const { mockGetSolanaContext } = vi.hoisted(() => ({ mockGetSolanaContext: vi.fn() }));
vi.mock("../connection", () => ({ getSolanaContext: mockGetSolanaContext }));

const { mockFindUserPda, mockFetchMaybeUser, mockGetCreateUserInstructionAsync } = vi.hoisted(() => ({
  mockFindUserPda: vi.fn(),
  mockFetchMaybeUser: vi.fn(),
  mockGetCreateUserInstructionAsync: vi.fn(),
}));
vi.mock("on-chain-client", () => ({
  findUserPda: mockFindUserPda,
  fetchMaybeUser: mockFetchMaybeUser,
  getCreateUserInstructionAsync: mockGetCreateUserInstructionAsync,
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

const { mockCookieStore } = vi.hoisted(() => ({
  mockCookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
}));
vi.mock("next/headers", () => ({ cookies: async () => mockCookieStore }));

import { registerUser } from "./auth";

const USER_ADDRESS = "User1111111111111111111111111111111111111";
const ADMIN_ADDRESS = "Admin111111111111111111111111111111111111";

function userData(overrides: Partial<User> = {}): User {
  return {
    discriminator: new Uint8Array(8),
    bump: 255,
    username: "alice",
    salt: new Uint8Array(16),
    passwordHash: new Uint8Array(64),
    ...overrides,
  };
}

describe("registerUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret-value-not-used-in-prod";
    mockGetSolanaContext.mockResolvedValue({
      rpc: {
        getLatestBlockhash: () => ({
          send: async () => ({ value: { blockhash: "fake", lastValidBlockHeight: 1n } }),
        }),
      },
      rpcSubscriptions: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: "Prog1111111111111111111111111111111111111",
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
    mockGetCreateUserInstructionAsync.mockResolvedValue({
      programAddress: "Prog1111111111111111111111111111111111111",
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignTransactionMessageWithSigners.mockResolvedValue({});
    mockSendAndConfirmTransaction.mockResolvedValue(undefined);
  });

  it("rejects an invalid username before touching the chain", async () => {
    await expect(
      registerUser({ username: "a!", password: "Abcdef12", confirmPassword: "Abcdef12" }),
    ).rejects.toThrow();
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects an invalid password before touching the chain", async () => {
    await expect(
      registerUser({ username: "alice", password: "short", confirmPassword: "short" }),
    ).rejects.toThrow();
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirm-password before touching the chain", async () => {
    await expect(
      registerUser({ username: "alice", password: "Abcdef12", confirmPassword: "Abcdef13" }),
    ).rejects.toThrow("Passwords do not match");
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("creates the on-chain account and sets a session cookie on success", async () => {
    mockFetchMaybeUser.mockResolvedValue({ exists: false } as MaybeAccount<User>);

    await registerUser({ username: "alice", password: "Abcdef12", confirmPassword: "Abcdef12" });

    expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("surfaces a friendly error when the username is already taken", async () => {
    mockSendAndConfirmTransaction.mockRejectedValue(new Error("already in use"));
    mockFetchMaybeUser.mockResolvedValue({
      exists: true,
      address: USER_ADDRESS,
      data: userData(),
    } as MaybeAccount<User>);

    await expect(
      registerUser({ username: "alice", password: "Abcdef12", confirmPassword: "Abcdef12" }),
    ).rejects.toThrow("Username already taken");
    expect(mockCookieStore.set).not.toHaveBeenCalled();
  });
});
