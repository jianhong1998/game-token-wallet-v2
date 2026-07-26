import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MaybeAccount, Account, Address } from "@solana/kit";
import type { Registry, Game } from "on-chain-client";

const { mockGetSolanaContext } = vi.hoisted(() => ({ mockGetSolanaContext: vi.fn() }));
vi.mock("../connection", () => ({ getSolanaContext: mockGetSolanaContext }));

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("./auth", () => ({ getCurrentUsername: mockGetCurrentUsername }));

const { mockGenerateGameId } = vi.hoisted(() => ({ mockGenerateGameId: vi.fn() }));
vi.mock("../game-id", () => ({ generateGameId: mockGenerateGameId }));

const {
  mockFindUserPda,
  mockFindRegistryPda,
  mockFetchMaybeRegistry,
  mockFetchGame,
  mockGetCreateGameInstructionAsync,
} = vi.hoisted(() => ({
  mockFindUserPda: vi.fn(),
  mockFindRegistryPda: vi.fn(),
  mockFetchMaybeRegistry: vi.fn(),
  mockFetchGame: vi.fn(),
  mockGetCreateGameInstructionAsync: vi.fn(),
}));
vi.mock("on-chain-client", () => ({
  findUserPda: mockFindUserPda,
  findRegistryPda: mockFindRegistryPda,
  fetchMaybeRegistry: mockFetchMaybeRegistry,
  fetchGame: mockFetchGame,
  getCreateGameInstructionAsync: mockGetCreateGameInstructionAsync,
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

import { createGame, listMyGames } from "./game";

const ADMIN_ADDRESS = "Admin111111111111111111111111111111111111";
const USER_ADDRESS = "User1111111111111111111111111111111111111";
const REGISTRY_ADDRESS = "Regi11111111111111111111111111111111111111";
const PROGRAM_ADDRESS = "Prog1111111111111111111111111111111111111";
const GAME_ID_BYTES = new Uint8Array(16).fill(7);

function gameData(overrides: Partial<Game> = {}): Game {
  return {
    discriminator: new Uint8Array(8),
    bump: 255,
    mintBump: 254,
    gameId: GAME_ID_BYTES,
    name: "Friday Poker",
    mode: 0,
    admin: USER_ADDRESS,
    mint: "Mint111111111111111111111111111111111111111",
    ...overrides,
  } as Game;
}

describe("createGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockGenerateGameId.mockReturnValue(GAME_ID_BYTES);
    mockGetSolanaContext.mockResolvedValue({
      rpc: {
        getLatestBlockhash: () => ({
          send: async () => ({ value: { blockhash: "fake", lastValidBlockHeight: 1n } }),
        }),
      },
      rpcSubscriptions: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockGetCreateGameInstructionAsync.mockResolvedValue({
      programAddress: PROGRAM_ADDRESS,
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignTransactionMessageWithSigners.mockResolvedValue({});
    mockSendAndConfirmTransaction.mockResolvedValue(undefined);
  });

  it("rejects when not signed in, without touching the chain", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    const result = await createGame({ name: "Friday Poker" });
    expect(result).toEqual({ ok: false, error: "Not signed in" });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects an invalid name before touching the chain", async () => {
    const result = await createGame({ name: "ab" });
    expect(result.ok).toBe(false);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("creates the game and sends the transaction on success", async () => {
    await expect(createGame({ name: "Friday Poker" })).resolves.toEqual({ ok: true });
    expect(mockGetCreateGameInstructionAsync).toHaveBeenCalledWith(
      { admin: { address: ADMIN_ADDRESS }, username: "alice", gameId: GAME_ID_BYTES, name: "Friday Poker" },
      { programAddress: PROGRAM_ADDRESS },
    );
    expect(mockSendAndConfirmTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("listMyGames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockGetSolanaContext.mockResolvedValue({
      rpc: {},
      rpcSubscriptions: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
    mockFindRegistryPda.mockResolvedValue([REGISTRY_ADDRESS, 255]);
  });

  it("returns an empty list when not signed in", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(listMyGames()).resolves.toEqual([]);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("returns an empty list when the registry doesn't exist yet", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({ exists: false } as MaybeAccount<Registry>);
    await expect(listMyGames()).resolves.toEqual([]);
  });

  it("returns only games admined by the current user", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: {
        discriminator: new Uint8Array(8),
        bump: 255,
        activeGames: ["Game1", "Game2"] as Registry["activeGames"],
      },
      // Mock accounts only ever populate `address`/`data` — the remaining
      // BaseAccount fields (executable, lamports, programAddress, space)
      // are irrelevant to listMyGames() and TS won't structurally accept
      // the partial shape as a MaybeAccount<Registry> without routing
      // through `unknown` first (same tsc-suggested escape hatch as the
      // other two casts below).
    } as unknown as MaybeAccount<Registry>);
    mockFetchGame
      .mockResolvedValueOnce({
        address: "Game1" as Address,
        data: gameData({ admin: USER_ADDRESS as Address, name: "Mine" }),
      } as unknown as Account<Game>)
      .mockResolvedValueOnce({
        address: "Game2" as Address,
        data: gameData({
          admin: "SomeoneElse11111111111111111111111111111" as Address,
          name: "Not mine",
        }),
      } as unknown as Account<Game>);

    await expect(listMyGames()).resolves.toEqual([{ address: "Game1", name: "Mine" }]);
  });
});
