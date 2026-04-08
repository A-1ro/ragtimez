/**
 * Constant-time string comparison to prevent timing attacks when validating
 * secret tokens.  Iterates through all bytes of both strings regardless of
 * where the first mismatch occurs.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  // XOR the lengths so that a length difference always produces a non-zero result.
  let result = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return result === 0;
}
