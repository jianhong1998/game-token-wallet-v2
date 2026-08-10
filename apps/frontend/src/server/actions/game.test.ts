import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address } from "@solana/kit";
import type { Game } from "on-chain-client";

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
  mockFetchMaybeGame,
  mockGetCreateGameInstructionAsync,
  mockGetJoinGameInstructionAsync,
  mockGetMintToPlayerInstructionAsync,
  mockFetchAllUser,
  mockIsGameTokenWalletError,
} = vi.hoisted(() => ({
  mockFindUserPda: vi.fn(),
  mockFindRegistryPda: vi.fn(),
  mockFetchMaybeRegistry: vi.fn(),
  mockFetchGame: vi.fn(),
  mockFetchMaybeGame: vi.fn(),
  mockGetCreateGameInstructionAsync: vi.fn(),
  mockGetJoinGameInstructionAsync: vi.fn(),
  mockGetMintToPlayerInstructionAsync: vi.fn(),
  mockFetchAllUser: vi.fn(),
  mockIsGameTokenWalletError: vi.fn(),
}));
// Mirrors on-chain-client's actual generated error codes (see
// apps/on-chain-client/src/generated/errors/gameTokenWallet.ts) — only the
// codes joinGame()/depositToPlayer() map to friendly messages need real
// values here since mockIsGameTokenWalletError compares against them directly.
const {
  GAME_FULL_CODE,
  ALREADY_JOINED_GAME_CODE,
  NOT_GAME_ADMIN_CODE,
  PLAYER_NOT_IN_GAME_CODE,
} = vi.hoisted(() => ({
  GAME_FULL_CODE: 0x1774,
  ALREADY_JOINED_GAME_CODE: 0x1775,
  NOT_GAME_ADMIN_CODE: 0x1777,
  PLAYER_NOT_IN_GAME_CODE: 0x1778,
}));
vi.mock("on-chain-client", () => ({
  findUserPda: mockFindUserPda,
  findRegistryPda: mockFindRegistryPda,
  fetchMaybeRegistry: mockFetchMaybeRegistry,
  fetchGame: mockFetchGame,
  fetchMaybeGame: mockFetchMaybeGame,
  getCreateGameInstructionAsync: mockGetCreateGameInstructionAsync,
  getJoinGameInstructionAsync: mockGetJoinGameInstructionAsync,
  getMintToPlayerInstructionAsync: mockGetMintToPlayerInstructionAsync,
  fetchAllUser: mockFetchAllUser,
  isGameTokenWalletError: mockIsGameTokenWalletError,
  GAME_TOKEN_WALLET_ERROR__GAME_FULL: GAME_FULL_CODE,
  GAME_TOKEN_WALLET_ERROR__ALREADY_JOINED_GAME: ALREADY_JOINED_GAME_CODE,
  GAME_TOKEN_WALLET_ERROR__NOT_GAME_ADMIN: NOT_GAME_ADMIN_CODE,
  GAME_TOKEN_WALLET_ERROR__PLAYER_NOT_IN_GAME: PLAYER_NOT_IN_GAME_CODE,
}));

const { mockFindAssociatedTokenPda, mockGetTokenDecoder } = vi.hoisted(() => ({
  mockFindAssociatedTokenPda: vi.fn(),
  mockGetTokenDecoder: vi.fn(),
}));
vi.mock("@solana-program/token", () => ({
  findAssociatedTokenPda: mockFindAssociatedTokenPda,
  getTokenDecoder: mockGetTokenDecoder,
  TOKEN_PROGRAM_ADDRESS: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
}));

const { mockFetchEncodedAccount } = vi.hoisted(() => ({ mockFetchEncodedAccount: vi.fn() }));
vi.mock("@solana/kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/kit")>();
  return { ...actual, fetchEncodedAccount: mockFetchEncodedAccount };
});

const { mockSignAndSendTransaction } = vi.hoisted(() => ({
  mockSignAndSendTransaction: vi.fn(),
}));
vi.mock("../transaction", () => ({ signAndSendTransaction: mockSignAndSendTransaction }));

import {
  createGame,
  joinGame,
  depositToPlayer,
  listBrowseGames,
  listMyMemberGames,
  fetchGameDetail,
} from "./game";

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
    playerCount: 0,
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
    mockSignAndSendTransaction.mockResolvedValue(undefined);
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
      {
        admin: { address: ADMIN_ADDRESS },
        username: "alice",
        gameId: GAME_ID_BYTES,
        name: "Friday Poker",
      },
      { programAddress: PROGRAM_ADDRESS },
    );
    expect(mockSignAndSendTransaction).toHaveBeenCalledTimes(1);
  });
});

const GAME_ADDRESS = "Game11111111111111111111111111111111111111";
// Cast to `Address` (unlike GAME_ADDRESS/PLAYER_ATA_ADDRESS, which only ever
// flow into untyped `vi.fn()` mocks) because this one is also passed as a
// `gameData({ mint: MINT_ADDRESS })` override, and `Game["mint"]` is typed
// `Address` — a plain `string` isn't assignable to that branded type.
const MINT_ADDRESS = "Mint111111111111111111111111111111111111111" as Address;
const PLAYER_ATA_ADDRESS = "Ata111111111111111111111111111111111111111";

describe("joinGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("bob");
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
    mockFetchMaybeGame.mockResolvedValue({
      exists: true,
      address: GAME_ADDRESS,
      data: gameData({ mint: MINT_ADDRESS, playerCount: 3 }),
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
    mockFindAssociatedTokenPda.mockResolvedValue([PLAYER_ATA_ADDRESS, 254]);
    mockFetchEncodedAccount.mockResolvedValue({ exists: false });
    mockGetJoinGameInstructionAsync.mockResolvedValue({
      programAddress: PROGRAM_ADDRESS,
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignAndSendTransaction.mockResolvedValue(undefined);
    mockIsGameTokenWalletError.mockReturnValue(false);
  });

  it("rejects when not signed in, without touching the chain", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(joinGame(GAME_ADDRESS)).resolves.toEqual({ ok: false, error: "Not signed in" });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("maps an on-chain GameFull rejection (lost the race after the client-side pre-check) to the friendly message", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("simulation failed"));
    mockIsGameTokenWalletError.mockImplementation((_error, _tx, code) => code === GAME_FULL_CODE);
    await expect(joinGame(GAME_ADDRESS)).resolves.toEqual({
      ok: false,
      error: "This game already has the maximum of 20 players",
    });
  });

  it("maps an on-chain AlreadyJoinedGame rejection (stale browse list) to the friendly message", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("simulation failed"));
    mockIsGameTokenWalletError.mockImplementation(
      (_error, _tx, code) => code === ALREADY_JOINED_GAME_CODE,
    );
    await expect(joinGame(GAME_ADDRESS)).resolves.toEqual({
      ok: false,
      error: "You are already a player in this game",
    });
  });

  it("re-throws an on-chain error that isn't a recognized join_game program error", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("network blip"));
    mockIsGameTokenWalletError.mockReturnValue(false);
    await expect(joinGame(GAME_ADDRESS)).rejects.toThrow("network blip");
  });

  it("rejects when the game doesn't exist", async () => {
    mockFetchMaybeGame.mockResolvedValue({ exists: false });
    await expect(joinGame(GAME_ADDRESS)).resolves.toEqual({ ok: false, error: "Game not found" });
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the game is already at the 20-player cap", async () => {
    mockFetchMaybeGame.mockResolvedValue({
      exists: true,
      address: GAME_ADDRESS,
      data: gameData({ mint: MINT_ADDRESS, playerCount: 20 }),
    });
    const result = await joinGame(GAME_ADDRESS);
    expect(result.ok).toBe(false);
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the viewer's ATA for this game already exists", async () => {
    mockFetchEncodedAccount.mockResolvedValue({ exists: true });
    const result = await joinGame(GAME_ADDRESS);
    expect(result.ok).toBe(false);
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });

  it("joins and sends the transaction on success", async () => {
    await expect(joinGame(GAME_ADDRESS)).resolves.toEqual({ ok: true });
    expect(mockGetJoinGameInstructionAsync).toHaveBeenCalledWith(
      {
        admin: { address: ADMIN_ADDRESS },
        username: "bob",
        gameId: expect.anything(),
        playerAta: PLAYER_ATA_ADDRESS,
      },
      { programAddress: PROGRAM_ADDRESS },
    );
    expect(mockSignAndSendTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("listBrowseGames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: () => ({ send: async () => ({ value: [] }) }) },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockFindRegistryPda.mockResolvedValue([REGISTRY_ADDRESS, 255]);
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
  });

  it("returns an empty list when not signed in", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(listBrowseGames()).resolves.toEqual([]);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("returns an empty list when the registry doesn't exist yet", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({ exists: false });
    await expect(listBrowseGames()).resolves.toEqual([]);
  });

  it("marks membership per game from a batched account-existence check", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1", "Game2"] },
    });
    mockFetchGame
      .mockResolvedValueOnce({
        address: "Game1",
        data: gameData({
          name: "Mine already",
          playerCount: 5,
          mint: "Mint1111111111111111111111111111111111111" as Address,
        }),
      })
      .mockResolvedValueOnce({
        address: "Game2",
        data: gameData({
          name: "Not joined",
          playerCount: 2,
          mint: "Mint2222222222222222222222222222222222222" as Address,
        }),
      });
    mockFindAssociatedTokenPda
      .mockResolvedValueOnce(["Ata1", 254])
      .mockResolvedValueOnce(["Ata2", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({
      send: async () => ({ value: [{ exists: true }, null] }),
    }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });

    await expect(listBrowseGames()).resolves.toEqual([
      { address: "Game1", name: "Mine already", mode: 0, playerCount: 5, isMember: true },
      { address: "Game2", name: "Not joined", mode: 0, playerCount: 2, isMember: false },
    ]);
    expect(mockGetMultipleAccounts).toHaveBeenCalledWith(["Ata1", "Ata2"]);
  });
});

describe("listMyMemberGames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFindRegistryPda.mockResolvedValue([REGISTRY_ADDRESS, 255]);
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
  });

  it("returns an empty list when not signed in", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(listMyMemberGames()).resolves.toEqual([]);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("returns an empty list when the registry doesn't exist yet", async () => {
    mockGetSolanaContext.mockResolvedValue({
      rpc: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockFetchMaybeRegistry.mockResolvedValue({ exists: false });
    await expect(listMyMemberGames()).resolves.toEqual([]);
  });

  it("excludes games where the user is neither a player nor the admin", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1"] },
    });
    mockFetchGame.mockResolvedValueOnce({
      address: "Game1",
      data: gameData({
        admin: "SomeoneElse11111111111111111111111111111" as Address,
        mint: MINT_ADDRESS,
      }),
    });
    mockFindAssociatedTokenPda.mockResolvedValueOnce(["Ata1", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({ send: async () => ({ value: [null] }) }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });

    await expect(listMyMemberGames()).resolves.toEqual([]);
  });

  it("includes a player-only game with its decoded balance", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1"] },
    });
    mockFetchGame.mockResolvedValueOnce({
      address: "Game1",
      data: gameData({
        name: "Friday Poker",
        admin: "SomeoneElse11111111111111111111111111111" as Address,
        mint: MINT_ADDRESS,
      }),
    });
    mockFindAssociatedTokenPda.mockResolvedValueOnce(["Ata1", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({
      send: async () => ({ value: [{ data: ["ZmFrZQ==", "base64"] }] }),
    }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockGetTokenDecoder.mockReturnValue({
      decode: vi.fn().mockReturnValue({ amount: 250n }),
    });

    await expect(listMyMemberGames()).resolves.toEqual([
      { address: "Game1", name: "Friday Poker", mode: 0, balance: 2.5, isAdmin: false },
    ]);
    expect(mockGetMultipleAccounts).toHaveBeenCalledWith(["Ata1"]);
  });

  it("includes an admin-only game with balance 0 when the admin has no ATA yet", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1"] },
    });
    mockFetchGame.mockResolvedValueOnce({
      address: "Game1",
      data: gameData({ name: "New Game", admin: USER_ADDRESS as Address, mint: MINT_ADDRESS }),
    });
    mockFindAssociatedTokenPda.mockResolvedValueOnce(["Ata1", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({ send: async () => ({ value: [null] }) }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });

    await expect(listMyMemberGames()).resolves.toEqual([
      { address: "Game1", name: "New Game", mode: 0, balance: 0, isAdmin: true },
    ]);
  });

  it("marks isAdmin true and uses the real balance for an admin who has also joined as a player", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1"] },
    });
    mockFetchGame.mockResolvedValueOnce({
      address: "Game1",
      data: gameData({ name: "Mixed", admin: USER_ADDRESS as Address, mint: MINT_ADDRESS }),
    });
    mockFindAssociatedTokenPda.mockResolvedValueOnce(["Ata1", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({
      send: async () => ({ value: [{ data: ["ZmFrZQ==", "base64"] }] }),
    }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockGetTokenDecoder.mockReturnValue({
      decode: vi.fn().mockReturnValue({ amount: 400n }),
    });

    await expect(listMyMemberGames()).resolves.toEqual([
      { address: "Game1", name: "Mixed", mode: 0, balance: 4, isAdmin: true },
    ]);
  });

  it("returns multiple games mixing player, admin, and excluded games", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1", "Game2", "Game3"] },
    });
    mockFetchGame
      .mockResolvedValueOnce({
        address: "Game1",
        data: gameData({
          name: "Player game",
          admin: "SomeoneElse11111111111111111111111111111" as Address,
          mint: "Mint1111111111111111111111111111111111111" as Address,
        }),
      })
      .mockResolvedValueOnce({
        address: "Game2",
        data: gameData({
          name: "Admin game",
          admin: USER_ADDRESS as Address,
          mint: "Mint2222222222222222222222222222222222222" as Address,
        }),
      })
      .mockResolvedValueOnce({
        address: "Game3",
        data: gameData({
          name: "Not mine",
          admin: "SomeoneElse11111111111111111111111111111" as Address,
          mint: "Mint3333333333333333333333333333333333333" as Address,
        }),
      });
    mockFindAssociatedTokenPda
      .mockResolvedValueOnce(["Ata1", 254])
      .mockResolvedValueOnce(["Ata2", 254])
      .mockResolvedValueOnce(["Ata3", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({
      send: async () => ({ value: [{ data: ["ZmFrZQ==", "base64"] }, null, null] }),
    }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockGetTokenDecoder.mockReturnValue({
      decode: vi.fn().mockReturnValue({ amount: 100n }),
    });

    await expect(listMyMemberGames()).resolves.toEqual([
      { address: "Game1", name: "Player game", mode: 0, balance: 1, isAdmin: false },
      { address: "Game2", name: "Admin game", mode: 0, balance: 0, isAdmin: true },
    ]);
  });
});

describe("fetchGameDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
  });

  it("returns null when not signed in", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(fetchGameDetail(GAME_ADDRESS)).resolves.toBeNull();
  });

  it("returns null when the game doesn't exist", async () => {
    mockGetSolanaContext.mockResolvedValue({
      rpc: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockFetchMaybeGame.mockResolvedValue({ exists: false });
    await expect(fetchGameDetail(GAME_ADDRESS)).resolves.toBeNull();
  });

  it("returns the roster with balances and identifies the viewer and the admin", async () => {
    mockFetchMaybeGame.mockResolvedValue({
      exists: true,
      address: GAME_ADDRESS,
      data: gameData({
        admin: "AdminUser1111111111111111111111111111111" as Address,
        mint: MINT_ADDRESS,
      }),
    });
    const rawTokenAccountBase64 = "ZmFrZS10b2tlbi1hY2NvdW50LWJ5dGVz";
    mockGetSolanaContext.mockResolvedValue({
      rpc: {
        getProgramAccounts: () => ({
          send: async () => ({
            value: [
              { pubkey: "PlayerAta1", account: { data: [rawTokenAccountBase64, "base64"] } },
              { pubkey: "PlayerAta2", account: { data: [rawTokenAccountBase64, "base64"] } },
            ],
          }),
        }),
      },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockGetTokenDecoder.mockReturnValue({
      decode: vi
        .fn()
        .mockReturnValueOnce({ owner: "AdminUser1111111111111111111111111111111", amount: 400n })
        .mockReturnValueOnce({ owner: USER_ADDRESS, amount: 150n }),
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
    mockFetchAllUser.mockResolvedValue([
      { data: { username: "alice" } },
      { data: { username: "bob" } },
    ]);

    const detail = await fetchGameDetail(GAME_ADDRESS);
    expect(detail).toEqual({
      address: GAME_ADDRESS,
      name: "Friday Poker",
      mode: 0,
      isAdmin: false,
      myBalance: 1.5,
      players: [
        { username: "alice", balance: 4, isAdmin: true },
        { username: "bob", balance: 1.5, isAdmin: false },
      ],
    });
  });
});

describe("depositToPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("hostadmin");
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
    mockFetchMaybeGame.mockResolvedValue({
      exists: true,
      address: GAME_ADDRESS,
      data: gameData({ mint: MINT_ADDRESS }),
    });
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
    mockFindAssociatedTokenPda.mockResolvedValue([PLAYER_ATA_ADDRESS, 254]);
    mockGetMintToPlayerInstructionAsync.mockResolvedValue({
      programAddress: PROGRAM_ADDRESS,
      accounts: [],
      data: new Uint8Array(),
    });
    mockSignAndSendTransaction.mockResolvedValue(undefined);
    mockIsGameTokenWalletError.mockReturnValue(false);
  });

  it("rejects when not signed in, without touching the chain", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(
      depositToPlayer({ gameAddress: GAME_ADDRESS, playerUsername: "bob", amount: 5 }),
    ).resolves.toEqual({ ok: false, error: "Not signed in" });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects a zero amount before touching the chain", async () => {
    const result = await depositToPlayer({
      gameAddress: GAME_ADDRESS,
      playerUsername: "bob",
      amount: 0,
    });
    expect(result).toEqual({ ok: false, error: "Amount must be greater than zero" });
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects a negative amount before touching the chain", async () => {
    const result = await depositToPlayer({
      gameAddress: GAME_ADDRESS,
      playerUsername: "bob",
      amount: -5,
    });
    expect(result.ok).toBe(false);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("rejects when the game doesn't exist", async () => {
    mockFetchMaybeGame.mockResolvedValue({ exists: false });
    const result = await depositToPlayer({
      gameAddress: GAME_ADDRESS,
      playerUsername: "bob",
      amount: 5,
    });
    expect(result).toEqual({ ok: false, error: "Game not found" });
    expect(mockSignAndSendTransaction).not.toHaveBeenCalled();
  });

  it("converts whole-token amount to base units and sends the transaction on success", async () => {
    await expect(
      depositToPlayer({ gameAddress: GAME_ADDRESS, playerUsername: "bob", amount: 5 }),
    ).resolves.toEqual({ ok: true });
    expect(mockGetMintToPlayerInstructionAsync).toHaveBeenCalledWith(
      {
        admin: { address: ADMIN_ADDRESS },
        username: "hostadmin",
        gameId: expect.anything(),
        playerUsername: "bob",
        playerAta: PLAYER_ATA_ADDRESS,
        amount: 500n,
      },
      { programAddress: PROGRAM_ADDRESS },
    );
    expect(mockSignAndSendTransaction).toHaveBeenCalledTimes(1);
  });

  it("maps an on-chain NotGameAdmin rejection to the friendly message", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("simulation failed"));
    mockIsGameTokenWalletError.mockImplementation(
      (_error, _tx, code) => code === NOT_GAME_ADMIN_CODE,
    );
    await expect(
      depositToPlayer({ gameAddress: GAME_ADDRESS, playerUsername: "bob", amount: 5 }),
    ).resolves.toEqual({ ok: false, error: "Only the game's admin can deposit tokens" });
  });

  it("maps an on-chain PlayerNotInGame rejection to the friendly message", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("simulation failed"));
    mockIsGameTokenWalletError.mockImplementation(
      (_error, _tx, code) => code === PLAYER_NOT_IN_GAME_CODE,
    );
    await expect(
      depositToPlayer({ gameAddress: GAME_ADDRESS, playerUsername: "bob", amount: 5 }),
    ).resolves.toEqual({ ok: false, error: "That player hasn't joined this game" });
  });

  it("re-throws an on-chain error that isn't a recognized mint_to_player program error", async () => {
    mockSignAndSendTransaction.mockRejectedValue(new Error("network blip"));
    mockIsGameTokenWalletError.mockReturnValue(false);
    await expect(
      depositToPlayer({ gameAddress: GAME_ADDRESS, playerUsername: "bob", amount: 5 }),
    ).rejects.toThrow("network blip");
  });
});
