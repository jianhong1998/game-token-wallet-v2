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

const { mockCookieStore, mockHeadersStore } = vi.hoisted(() => ({
  mockCookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  // Defaults to no `x-forwarded-proto` header, i.e. plain HTTP with no
  // TLS-terminating reverse proxy in front — the e2e/local Docker case.
  mockHeadersStore: { get: vi.fn() },
}));
vi.mock("next/headers", () => ({
  cookies: async () => mockCookieStore,
  headers: async () => mockHeadersStore,
}));

import { registerUser, loginUser, logoutUser, getCurrentUsername } from "./auth";

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
    const result = await registerUser({ username: "a!", password: "Abcdef12", confirmPassword: "Abcdef12" });
    expect(result.ok).toBe(false);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects an invalid password before touching the chain", async () => {
    const result = await registerUser({ username: "alice", password: "short", confirmPassword: "short" });
    expect(result.ok).toBe(false);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirm-password before touching the chain", async () => {
    await expect(
      registerUser({ username: "alice", password: "Abcdef12", confirmPassword: "Abcdef13" }),
    ).resolves.toEqual({ ok: false, error: "Passwords do not match" });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("creates the on-chain account and sets a session cookie on success", async () => {
    mockFetchMaybeUser.mockResolvedValue({ exists: false } as MaybeAccount<User>);

    await expect(
      registerUser({ username: "alice", password: "Abcdef12", confirmPassword: "Abcdef12" }),
    ).resolves.toEqual({ ok: true });

    expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: false }),
    );
  });

  it("sets secure:true on the session cookie when x-forwarded-proto is https", async () => {
    mockFetchMaybeUser.mockResolvedValue({ exists: false } as MaybeAccount<User>);
    mockHeadersStore.get.mockImplementation((name: string) =>
      name === "x-forwarded-proto" ? "https" : null,
    );

    await registerUser({ username: "alice", password: "Abcdef12", confirmPassword: "Abcdef12" });

    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "session",
      expect.any(String),
      expect.objectContaining({ secure: true }),
    );
  });

  it("sets secure:false on the session cookie when x-forwarded-proto is absent", async () => {
    mockFetchMaybeUser.mockResolvedValue({ exists: false } as MaybeAccount<User>);
    mockHeadersStore.get.mockReturnValue(null);

    await registerUser({ username: "alice", password: "Abcdef12", confirmPassword: "Abcdef12" });

    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "session",
      expect.any(String),
      expect.objectContaining({ secure: false }),
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
    ).resolves.toEqual({ ok: false, error: "Username already taken" });
    expect(mockCookieStore.set).not.toHaveBeenCalled();
  });
});

describe("loginUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret-value-not-used-in-prod";
    mockGetSolanaContext.mockResolvedValue({
      rpc: {},
      rpcSubscriptions: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: "Prog1111111111111111111111111111111111111",
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
  });

  it("sets a session cookie when the password is correct", async () => {
    const { hashPassword } = await import("../password");
    const { salt, hash } = await hashPassword("Abcdef12");
    mockFetchMaybeUser.mockResolvedValue({
      exists: true,
      address: USER_ADDRESS,
      data: userData({ salt, passwordHash: hash }),
    } as MaybeAccount<User>);

    await expect(loginUser({ username: "alice", password: "Abcdef12" })).resolves.toEqual({ ok: true });

    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: false }),
    );
  });

  it("returns a generic error when the password is wrong", async () => {
    const { hashPassword } = await import("../password");
    const { salt, hash } = await hashPassword("Abcdef12");
    mockFetchMaybeUser.mockResolvedValue({
      exists: true,
      address: USER_ADDRESS,
      data: userData({ salt, passwordHash: hash }),
    } as MaybeAccount<User>);

    await expect(loginUser({ username: "alice", password: "wrong-password" })).resolves.toEqual({
      ok: false,
      error: "Invalid username or password",
    });
    expect(mockCookieStore.set).not.toHaveBeenCalled();
  });

  it("returns the identical generic error when the username doesn't exist", async () => {
    mockFetchMaybeUser.mockResolvedValue({ exists: false } as MaybeAccount<User>);

    await expect(loginUser({ username: "nobody", password: "Abcdef12" })).resolves.toEqual({
      ok: false,
      error: "Invalid username or password",
    });
    expect(mockCookieStore.set).not.toHaveBeenCalled();
  });
});

describe("logoutUser", () => {
  it("clears the session cookie", async () => {
    vi.clearAllMocks();
    await logoutUser();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("session");
  });
});

describe("getCurrentUsername", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-session-secret-value-not-used-in-prod";
  });

  it("returns null when there is no session cookie", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    await expect(getCurrentUsername()).resolves.toBeNull();
  });

  it("returns the username from a valid session cookie", async () => {
    const { createSessionCookie } = await import("../session");
    const cookie = await createSessionCookie("alice");
    mockCookieStore.get.mockReturnValue({ value: cookie });

    await expect(getCurrentUsername()).resolves.toBe("alice");
  });
});
