import * as crypto from 'crypto';

/**
 * PKCE helpers (RFC 7636). We require S256; `plain` is rejected per OAuth 2.1.
 */

export const sha256Base64Url = (input: string): string => {
  return crypto
    .createHash('sha256')
    .update(input)
    .digest('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

export const verifyPkce = (
  codeVerifier: string,
  codeChallenge: string,
  method: string,
): boolean => {
  if (method !== 'S256') return false;
  if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  const computed = sha256Base64Url(codeVerifier);
  return safeEqual(computed, codeChallenge);
};

export const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return crypto.timingSafeEqual(ab, bb);
};

export const randomToken = (bytes: number): string => {
  return crypto
    .randomBytes(bytes)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};
