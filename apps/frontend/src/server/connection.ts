import {
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  address,
  type Address,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import bs58 from "bs58";
import { loadSolanaEnv } from "./env";

export interface SolanaContext {
  rpc: Rpc<SolanaRpcApi>;
  adminSigner: KeyPairSigner;
  programAddress: Address;
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
