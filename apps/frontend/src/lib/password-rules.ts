const PASSWORD_CHARSET = /^[A-Za-z0-9!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/;

export function validatePassword(
  password: string,
): { valid: true } | { valid: false; reason: string } {
  if (password.length < 8 || password.length > 20) {
    return { valid: false, reason: "Password must be between 8 and 20 characters" };
  }
  if (!PASSWORD_CHARSET.test(password)) {
    return { valid: false, reason: "Password contains a disallowed character" };
  }
  return { valid: true };
}
