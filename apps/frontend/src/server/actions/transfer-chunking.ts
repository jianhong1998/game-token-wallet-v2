import {
  createTransactionMessage,
  setTransactionMessageFeePayer,
  appendTransactionMessageInstructions,
  getTransactionMessageSize,
  TRANSACTION_SIZE_LIMIT,
  type Address,
  type Instruction,
} from "@solana/kit";

// Safety margin below @solana/kit's real TRANSACTION_SIZE_LIMIT (1232
// bytes) — compact-u16 length-prefix widths can shift by a byte at certain
// thresholds, so packing right up to the hard limit risks an off-by-one
// overflow once blockhash/signatures are attached at send time. See
// openspec/changes/general-mode-transfers/design.md decision 3.
const CHUNK_BYTE_BUDGET = TRANSACTION_SIZE_LIMIT - 32;

// Chosen defensive ceiling, well above what transfer_token ever needs (44
// accounts at the 19-recipient worst case) — cheap protection against
// future account additions to the instruction, not a protocol-mandated
// number (see design.md decision 3).
const MAX_ACCOUNTS_PER_CHUNK = 64;

function uniqueAccountCount(instructions: readonly Instruction[]): number {
  const keys = new Set<string>();
  for (const instruction of instructions) {
    for (const account of instruction.accounts ?? []) {
      keys.add(account.address);
    }
  }
  return keys.size;
}

// Packs instructions into the fewest transactions that each fit Solana's
// real per-transaction size limit, measured by actually compiling each
// candidate message via @solana/kit — no hand-rolled byte estimator, so
// this stays correct regardless of username length or future instruction
// changes. See design.md decision 3 for why a hardcoded per-chunk recipient
// count was rejected.
export function chunkInstructionsBySize(
  instructions: readonly Instruction[],
  feePayer: Address,
): Instruction[][] {
  const chunks: Instruction[][] = [];
  let current: Instruction[] = [];

  for (const instruction of instructions) {
    const candidate = [...current, instruction];
    const candidateMessage = appendTransactionMessageInstructions(
      candidate,
      setTransactionMessageFeePayer(feePayer, createTransactionMessage({ version: 0 })),
    );
    const fits =
      getTransactionMessageSize(candidateMessage) <= CHUNK_BYTE_BUDGET &&
      uniqueAccountCount(candidate) <= MAX_ACCOUNTS_PER_CHUNK;

    if (fits || current.length === 0) {
      current = candidate;
    } else {
      chunks.push(current);
      current = [instruction];
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
