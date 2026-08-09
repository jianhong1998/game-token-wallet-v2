import type { GameMode } from "on-chain-client";

export function gameModeLabel(mode: GameMode): string {
  return mode === 0 ? "General Mode" : mode === 1 ? "Poker Mode" : "Pool Mode";
}
