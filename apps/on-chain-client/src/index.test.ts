import { describe, it, expect } from "vitest";
import {
  getNoopInstruction,
  GAME_TOKEN_WALLET_PROGRAM_ADDRESS,
  getInitializeRegistryInstructionAsync,
  findRegistryPda,
  fetchMaybeRegistry,
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
});
