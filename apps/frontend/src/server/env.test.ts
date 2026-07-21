import { describe, it, expect, beforeEach } from "vitest";
import { loadSolanaEnv } from "./env";

const REQUIRED_VARS = ["SOLANA_CLUSTER", "SOLANA_RPC_URL", "PROGRAM_ID", "SYSTEM_ADMIN_SECRET_KEY"];

function setValidEnv() {
  process.env.SOLANA_CLUSTER = "localnet";
  process.env.SOLANA_RPC_URL = "http://127.0.0.1:8899";
  process.env.PROGRAM_ID = "11111111111111111111111111111111";
  process.env.SYSTEM_ADMIN_SECRET_KEY =
    "PzfkD238UH1WRMoQZpt9uJpJda2eLJYtv7Bi7qscpjWH3E1Fjm2odmcSu1XDz1FTz2yZfBWfYBYU4arQzFNNmis";
}

describe("loadSolanaEnv", () => {
  beforeEach(() => {
    for (const key of REQUIRED_VARS) delete process.env[key];
  });

  it("returns parsed config when all vars are set", () => {
    setValidEnv();
    expect(loadSolanaEnv()).toEqual({
      cluster: "localnet",
      rpcUrl: "http://127.0.0.1:8899",
      programId: "11111111111111111111111111111111",
      adminSecretKeyBase58:
        "PzfkD238UH1WRMoQZpt9uJpJda2eLJYtv7Bi7qscpjWH3E1Fjm2odmcSu1XDz1FTz2yZfBWfYBYU4arQzFNNmis",
    });
  });

  it("throws when a required var is missing", () => {
    setValidEnv();
    delete process.env.PROGRAM_ID;
    expect(() => loadSolanaEnv()).toThrow(
      "Missing required environment variable: PROGRAM_ID",
    );
  });

  it("throws when SOLANA_CLUSTER is not a recognized value", () => {
    setValidEnv();
    process.env.SOLANA_CLUSTER = "testnet";
    expect(() => loadSolanaEnv()).toThrow(/Invalid SOLANA_CLUSTER/);
  });
});
