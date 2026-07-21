import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  address,
  type Address,
  type KeyPairSigner,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import bs58 from "bs58";
import { loadSolanaEnv } from "./env";

export interface SolanaContext {
  rpc: Rpc<SolanaRpcApi>;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
  adminSigner: KeyPairSigner;
  programAddress: Address;
}

// Solana JSON-RPC servers (solana-test-validator, agave-validator,
// surfpool) serve the WS pub-sub endpoint on a *separate* port —
// rpc_port + 1 by default (e.g. RPC on 8899, WS on 8900) — but ONLY when
// that's the well-known local-validator RPC port. Public clusters and
// hosted RPC providers (devnet/mainnet-beta, third-party providers) expose
// WS on the exact same host with only the scheme swapped — no port change,
// invented or otherwise. Since there is no reliable signal in a bare URL
// to distinguish "a local validator on a nonstandard port" from "a hosted
// provider that happens to use that port", we only apply the +1 convention
// when the explicit port is exactly the local-validator default (8899);
// every other case (including no explicit port at all) is a pure scheme
// swap.
export function deriveWsUrl(rpcUrl: string): string {
  const parsed = new URL(rpcUrl);
  const wsUrl = new URL(parsed);
  wsUrl.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";

  if (parsed.port === "8899") {
    wsUrl.port = "8900";
  }

  return wsUrl.toString();
}

let contextPromise: Promise<SolanaContext> | null = null;

async function createContext(): Promise<SolanaContext> {
  const env = loadSolanaEnv();

  const secretKeyBytes = bs58.decode(env.adminSecretKeyBase58);
  if (secretKeyBytes.length !== 64) {
    throw new Error(
      `Invalid SYSTEM_ADMIN_SECRET_KEY: decoded to ${secretKeyBytes.length} bytes, expected 64`,
    );
  }

  const adminSigner = await createKeyPairSignerFromBytes(secretKeyBytes);

  return {
    rpc: createSolanaRpc(env.rpcUrl),
    rpcSubscriptions: createSolanaRpcSubscriptions(deriveWsUrl(env.rpcUrl)),
    adminSigner,
    programAddress: address(env.programId),
  };
}

export function getSolanaContext(): Promise<SolanaContext> {
  if (!contextPromise) {
    contextPromise = createContext();
  }
  return contextPromise;
}
