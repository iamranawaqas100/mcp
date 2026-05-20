import {
  OAuthAuthorizationCodeRecord,
  OAuthClientRecord,
  OAuthTokenRecord,
} from './types';

const clients = new Map<string, OAuthClientRecord>();
const authCodes = new Map<string, OAuthAuthorizationCodeRecord>();
const refreshTokens = new Map<string, OAuthTokenRecord>();
/** Access-token JTIs revoked via refresh rotation or POST /oauth/revoke. */
const revokedAccessJtis = new Set<string>();

export const saveOAuthClient = (row: OAuthClientRecord): void => {
  clients.set(row.client_id, row);
};

export const findOAuthClient = (clientId: string): OAuthClientRecord | undefined => {
  const row = clients.get(clientId);
  return row && !row.is_disabled ? row : undefined;
};

export const saveAuthCode = (row: OAuthAuthorizationCodeRecord): void => {
  authCodes.set(row.code, row);
};

export const findAuthCode = (code: string): OAuthAuthorizationCodeRecord | undefined => {
  return authCodes.get(code);
};

export const consumeAuthCode = (code: string): OAuthAuthorizationCodeRecord | null => {
  const row = authCodes.get(code);
  if (!row || row.consumed) return null;
  row.consumed = true;
  authCodes.set(code, row);
  return row;
};

export const saveRefreshToken = (row: OAuthTokenRecord): void => {
  refreshTokens.set(row.refresh_token_hash, row);
};

export const findRefreshToken = (hash: string): OAuthTokenRecord | undefined => {
  return refreshTokens.get(hash);
};

export const revokeRefreshToken = (hash: string): void => {
  const row = refreshTokens.get(hash);
  if (!row || row.revoked_at) return;
  row.revoked_at = new Date();
  revokedAccessJtis.add(row.last_access_jti);
  refreshTokens.set(hash, row);
};

export const isAccessJtiRevoked = (jti: string): boolean => revokedAccessJtis.has(jti);

export const cleanupExpiredAuthCodes = (): void => {
  const now = new Date();
  authCodes.forEach((row, key) => {
    if (row.expires_at < now || row.consumed) authCodes.delete(key);
  });
};

export const cleanupExpiredRefreshTokens = (): void => {
  const now = new Date();
  refreshTokens.forEach((row, key) => {
    if (row.expires_at < now) refreshTokens.delete(key);
  });
};
