export const MIN_USERNAME_BYTES = 3;
export const MAX_USERNAME_BYTES = 32;

const USERNAME_CHARSET = /^[\p{L}\p{N} ]+$/u;

export function normalizeUsername(input: string): string {
  return input.normalize("NFC").toLowerCase().normalize("NFC");
}

export function validateUsername(
  normalized: string,
): { valid: true } | { valid: false; reason: string } {
  const byteLength = new TextEncoder().encode(normalized).length;
  if (byteLength < MIN_USERNAME_BYTES || byteLength > MAX_USERNAME_BYTES) {
    return {
      valid: false,
      reason: `Username must be between ${MIN_USERNAME_BYTES} and ${MAX_USERNAME_BYTES} bytes`,
    };
  }
  if (!USERNAME_CHARSET.test(normalized)) {
    return { valid: false, reason: "Username can only contain letters, numbers, and spaces" };
  }
  return { valid: true };
}
