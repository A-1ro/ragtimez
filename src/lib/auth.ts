/**
 * Constant-time string comparison to prevent timing attacks when validating
 * secret tokens. Delegates to the Cloudflare Workers native
 * crypto.subtle.timingSafeEqual which is guaranteed to run in constant time.
 * A length pre-check is required because crypto.subtle.timingSafeEqual throws
 * when the two ArrayBuffers have different byte lengths.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}
