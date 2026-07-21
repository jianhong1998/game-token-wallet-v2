export type SolanaCluster = "localnet" | "devnet" | "mainnet-beta";

export interface SolanaEnv {
  cluster: SolanaCluster;
  rpcUrl: string;
  programId: string;
  adminSecretKeyBase58: string;
}

const CLUSTERS: readonly SolanaCluster[] = ["localnet", "devnet", "mainnet-beta"];

function readRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadSolanaEnv(): SolanaEnv {
  const cluster = readRequiredEnvVar("SOLANA_CLUSTER");
  if (!CLUSTERS.includes(cluster as SolanaCluster)) {
    throw new Error(
      `Invalid SOLANA_CLUSTER "${cluster}": expected one of ${CLUSTERS.join(", ")}`,
    );
  }
  return {
    cluster: cluster as SolanaCluster,
    rpcUrl: readRequiredEnvVar("SOLANA_RPC_URL"),
    programId: readRequiredEnvVar("PROGRAM_ID"),
    adminSecretKeyBase58: readRequiredEnvVar("SYSTEM_ADMIN_SECRET_KEY"),
  };
}
