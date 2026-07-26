export const MIN_GAME_NAME_BYTES = 3;
export const MAX_GAME_NAME_BYTES = 32;

const GAME_NAME_CHARSET = /^[\p{L}\p{N} ]+$/u;

export function normalizeGameName(input: string): string {
  return input.normalize("NFC");
}

export function validateGameName(
  normalized: string,
): { valid: true } | { valid: false; reason: string } {
  const byteLength = new TextEncoder().encode(normalized).length;
  if (byteLength < MIN_GAME_NAME_BYTES || byteLength > MAX_GAME_NAME_BYTES) {
    return {
      valid: false,
      reason: `Game name must be between ${MIN_GAME_NAME_BYTES} and ${MAX_GAME_NAME_BYTES} bytes`,
    };
  }
  if (!GAME_NAME_CHARSET.test(normalized)) {
    return { valid: false, reason: "Game name can only contain letters, numbers, and spaces" };
  }
  return { valid: true };
}
