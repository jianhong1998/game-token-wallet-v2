import { describe, it, expect, beforeEach, vi } from "vitest";

function setValidEnv() {
  process.env.SOLANA_CLUSTER = "localnet";
  process.env.SOLANA_RPC_URL = "http://127.0.0.1:8899";
  process.env.PROGRAM_ID = "11111111111111111111111111111111";
  process.env.SYSTEM_ADMIN_SECRET_KEY =
    "PzfkD238UH1WRMoQZpt9uJpJda2eLJYtv7Bi7qscpjWH3E1Fjm2odmcSu1XDz1FTz2yZfBWfYBYU4arQzFNNmis";
}

function clearEnv() {
  delete process.env.SOLANA_CLUSTER;
  delete process.env.SOLANA_RPC_URL;
  delete process.env.PROGRAM_ID;
  delete process.env.SYSTEM_ADMIN_SECRET_KEY;
}

describe("getSolanaContext", () => {
  beforeEach(() => {
    vi.resetModules();
    clearEnv();
  });

  it("returns the same context instance on repeated calls", async () => {
    setValidEnv();
    const { getSolanaContext } = await import("./connection");
    const first = await getSolanaContext();
    const second = await getSolanaContext();
    expect(second).toBe(first);
  });

  it("exposes an rpcSubscriptions client derived from the local-validator RPC URL (8899 -> 8900)", async () => {
    setValidEnv();
    process.env.SOLANA_RPC_URL = "http://127.0.0.1:8899";
    const { getSolanaContext } = await import("./connection");
    const context = await getSolanaContext();
    expect(context.rpcSubscriptions).toBeDefined();
  });

  it("rejects when SYSTEM_ADMIN_SECRET_KEY does not decode to 64 bytes", async () => {
    setValidEnv();
    process.env.SYSTEM_ADMIN_SECRET_KEY = "4g78KBwb1F7uAmFYDPKQDjXt9TcoUThChSVDBtCkXxfA";
    const { getSolanaContext } = await import("./connection");
    await expect(getSolanaContext()).rejects.toThrow(/Invalid SYSTEM_ADMIN_SECRET_KEY/);
  });

  it("rejects when a required env var is missing", async () => {
    setValidEnv();
    delete process.env.PROGRAM_ID;
    const { getSolanaContext } = await import("./connection");
    await expect(getSolanaContext()).rejects.toThrow(
      /Missing required environment variable: PROGRAM_ID/,
    );
  });
});

describe("deriveWsUrl", () => {
  it("derives ws port 8900 from the local-validator RPC convention on port 8899", async () => {
    const { deriveWsUrl } = await import("./connection");
    expect(deriveWsUrl("http://127.0.0.1:8899")).toBe("ws://127.0.0.1:8900/");
  });

  it("swaps scheme only for a public-cluster URL with no explicit port", async () => {
    const { deriveWsUrl } = await import("./connection");
    expect(deriveWsUrl("https://api.devnet.solana.com")).toBe(
      "wss://api.devnet.solana.com/",
    );
  });

  it("swaps scheme only, without inventing a port, for an explicit non-8899 port", async () => {
    const { deriveWsUrl } = await import("./connection");
    expect(deriveWsUrl("https://my-rpc-provider.example.com:443")).toBe(
      "wss://my-rpc-provider.example.com/",
    );
  });
});
