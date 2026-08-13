import { describe, it, expect } from "vitest";
import {
  address,
  generateKeyPairSigner,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  appendTransactionMessageInstructions,
  getTransactionMessageSize,
  TRANSACTION_SIZE_LIMIT,
} from "@solana/kit";
import { getTransferTokenInstructionAsync } from "on-chain-client";
import { chunkInstructionsBySize } from "./transfer-chunking";

const GAME_ID = new Uint8Array(16).fill(9);
// Worst case per design.md decision 3: usernames at the 32-byte max.
const MAX_USERNAME = "a".repeat(30);

async function buildInstructions(count: number) {
  const admin = await generateKeyPairSigner();
  const senderAta = await generateKeyPairSigner();
  const instructions = [];
  for (let i = 0; i < count; i++) {
    const recipientAta = await generateKeyPairSigner();
    instructions.push(
      await getTransferTokenInstructionAsync({
        admin,
        gameId: GAME_ID,
        senderUsername: `${MAX_USERNAME}s${i % 10}`,
        recipientUsername: `${MAX_USERNAME}r${i % 10}`,
        senderAta: senderAta.address,
        recipientAta: recipientAta.address,
        amount: 100n,
      }),
    );
  }
  return { admin, instructions };
}

describe("chunkInstructionsBySize", () => {
  it("returns no chunks for an empty instruction list", () => {
    expect(
      chunkInstructionsBySize([], address("11111111111111111111111111111111")),
    ).toEqual([]);
  });

  it("packs a small batch into a single chunk", async () => {
    const { admin, instructions } = await buildInstructions(2);
    const chunks = chunkInstructionsBySize(instructions, admin.address);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(2);
  });

  it("splits a 19-recipient max-username-length batch across multiple transactions, each within the real size limit", async () => {
    const { admin, instructions } = await buildInstructions(19);
    const chunks = chunkInstructionsBySize(instructions, admin.address);

    const totalRecipients = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(totalRecipients).toBe(19);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      const message = appendTransactionMessageInstructions(
        chunk,
        setTransactionMessageFeePayer(admin.address, createTransactionMessage({ version: 0 })),
      );
      expect(getTransactionMessageSize(message)).toBeLessThanOrEqual(TRANSACTION_SIZE_LIMIT);
    }
  });
});
