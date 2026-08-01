import { describe, it, expect } from "vitest";
import {
  GAME_TOKEN_WALLET_PROGRAM_ADDRESS,
  getInitializeRegistryInstructionAsync,
  findRegistryPda,
  fetchMaybeRegistry,
  getCreateUserInstructionAsync,
  findUserPda,
  fetchMaybeUser,
  GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH,
  findGamePda,
  fetchGame,
  getCreateGameInstructionAsync,
  GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH,
  GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_CHARACTERS,
  GAME_TOKEN_WALLET_ERROR__REGISTRY_FULL,
  isGameTokenWalletError,
} from "./index";

describe("generated on-chain-client", () => {
  it("exports the program address as a non-empty string", () => {
    expect(typeof GAME_TOKEN_WALLET_PROGRAM_ADDRESS).toBe("string");
    expect(GAME_TOKEN_WALLET_PROGRAM_ADDRESS.length).toBeGreaterThan(0);
  });

  it("exports a registry PDA finder, account fetcher, and initialize instruction builder", () => {
    expect(typeof findRegistryPda).toBe("function");
    expect(typeof fetchMaybeRegistry).toBe("function");
    expect(typeof getInitializeRegistryInstructionAsync).toBe("function");
  });

  it("exports a user PDA finder, account fetcher, create instruction builder, and error helpers", () => {
    expect(typeof findUserPda).toBe("function");
    expect(typeof fetchMaybeUser).toBe("function");
    expect(typeof getCreateUserInstructionAsync).toBe("function");
    expect(typeof GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH).toBe("number");
    expect(typeof isGameTokenWalletError).toBe("function");
  });

  it("exports a game PDA finder, account fetcher, create instruction builder, and error helpers", () => {
    expect(typeof findGamePda).toBe("function");
    expect(typeof fetchGame).toBe("function");
    expect(typeof getCreateGameInstructionAsync).toBe("function");
    expect(typeof GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_LENGTH).toBe("number");
    expect(typeof GAME_TOKEN_WALLET_ERROR__INVALID_GAME_NAME_CHARACTERS).toBe("number");
    expect(typeof GAME_TOKEN_WALLET_ERROR__REGISTRY_FULL).toBe("number");
  });
});
