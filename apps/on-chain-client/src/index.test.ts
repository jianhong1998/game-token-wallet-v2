import { describe, it, expect } from "vitest";
import {
  getNoopInstruction,
  GAME_TOKEN_WALLET_PROGRAM_ADDRESS,
  getInitializeRegistryInstructionAsync,
  findRegistryPda,
  fetchMaybeRegistry,
  getCreateUserInstructionAsync,
  findUserPda,
  fetchMaybeUser,
  GAME_TOKEN_WALLET_ERROR__INVALID_USERNAME_LENGTH,
  isGameTokenWalletError,
} from "./index";

describe("generated on-chain-client", () => {
  it("exports a noop instruction builder", () => {
    expect(typeof getNoopInstruction).toBe("function");
  });

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
});
