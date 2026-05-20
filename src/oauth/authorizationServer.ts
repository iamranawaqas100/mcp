import { Router, Request, Response } from 'express';
import * as bodyParser from 'body-parser';
import * as crypto from 'crypto';
import * as path from 'path';
import * as ejs from 'ejs';
import * as jwt from 'jsonwebtoken';
import { OAuthClientRecord } from './types';
import {
  cleanupExpiredAuthCodes,
  cleanupExpiredRefreshTokens,
  consumeAuthCode,
  findOAuthClient,
  findRefreshToken,
  revokeRefreshToken,
  saveAuthCode,
  saveOAuthClient,
  saveRefreshToken,
} from './memoryStore';
import { requireSrAccess } from './cookieBridge';
import { verifyPkce, randomToken, sha256Base64Url } from './pkce';
import { oauthIssuer, connectorResourceUrl } from './loginRedirect';
import logger from '../utils/logger';

/**
 * Minimal OAuth 2.1 + PKCE Authorization Server with Dynamic Client
 * Registration (RFC 7591). OAuth state is held in memory (no Postgres).
 */

const ACCESS_TOKEN_TTL_S = 15 * 60;
const REFRESH_TOKEN_TTL_S = 90 * 24 * 60 * 60;
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SCOPE = 'udm:read';

const issuer = (req?: Request): string => oauthIssuer(req);
const jwtSecret = (): string => {
  const s = process.env.MCP_JWT_SECRET;
  if (!s) throw new Error('MCP_JWT_SECRET is not set');
  return s;
};

interface PendingTx {
  client_id: string;
  redirect_uri: string;
  state: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  user_id: string;
  organisation_id: string | null;
  building_ids: string[];
  user_email: string;
  expires_at: number;
}
const pendingTransactions: Map<string, PendingTx> = new Map();

const reapPending = () => {
  const now = Date.now();
  pendingTransactions.forEach((tx, key) => {
    if (tx.expires_at < now) pendingTransactions.delete(key);
  });
};
setInterval(reapPending, 60 * 1000).unref();

const persistedBuildingIdsToScope = (ids?: string[] | null): string[] | '*' => {
  if (!ids || ids.length === 0) return [];
  if (ids.length === 1 && ids[0] === '*') return '*';
  return ids;
};

const safeRedirectUri = (client: OAuthClientRecord, requested: string): boolean => {
  if (!client.redirect_uris || !Array.isArray(client.redirect_uris)) return false;
  return client.redirect_uris.indexOf(requested) !== -1;
};

const renderConsent = async (
  req: Request,
  res: Response,
  data: { transactionId: string; clientName: string; userEmail: string; scopes: string[] },
): Promise<void> => {
  const tplPath = path.join(__dirname, 'views', 'consent.ejs');
  const html = await ejs.renderFile(tplPath, data);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
};

const scopeToHumanLines = (scope: string): string[] => {
  const out: string[] = [];
  const parts = (scope || '').split(/\s+/).filter(Boolean);
  for (const s of parts) {
    if (s === 'udm:read') out.push('Read your property analytics (occupancy, rent roll, KPIs)');
    else if (s === 'udm:query') out.push('Run advanced custom queries (admin)');
    else out.push(s);
  }
  if (out.length === 0) out.push('Read your property analytics (occupancy, rent roll, KPIs)');
  return out;
};

export const buildOAuthRouter = (): Router => {
  const router = Router();
  router.use(bodyParser.json());
  router.use(bodyParser.urlencoded({ extended: false }));

  router.get('/.well-known/oauth-authorization-server', (req, res) => {
    const iss = issuer(req);
    res.json({
      issuer: iss,
      authorization_endpoint: `${iss}/oauth/authorize`,
      token_endpoint: `${iss}/oauth/token`,
      revocation_endpoint: `${iss}/oauth/revoke`,
      registration_endpoint: `${iss}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      scopes_supported: ['udm:read', 'udm:query'],
    });
  });

  const serveProtectedResourceMetadata = (req: Request, res: Response): void => {
    const authServer = issuer(req);
    const resource = connectorResourceUrl(req);
    res.json({
      resource,
      authorization_servers: [authServer],
      scopes_supported: ['udm:read', 'udm:query'],
      bearer_methods_supported: ['header'],
    });
  };

  // RFC 9728 — root (legacy) and path-aware URL when resource is …/mcp
  router.get('/.well-known/oauth-protected-resource', serveProtectedResourceMetadata);
  router.get('/.well-known/oauth-protected-resource/mcp', serveProtectedResourceMetadata);

  router.post('/oauth/register', async (req, res) => {
    const body = req.body || {};
    const redirect_uris: string[] = body.redirect_uris || [];
    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris required' });
      return;
    }
    for (const u of redirect_uris) {
      try {
        const parsed = new URL(u);
        const isHttps = parsed.protocol === 'https:';
        const loopbackHosts = ['localhost', '127.0.0.1', '[::1]', '::1'];
        const isLoopbackHttp =
          parsed.protocol === 'http:' && loopbackHosts.indexOf(parsed.hostname) !== -1;
        const isPrivateUseScheme =
          parsed.protocol !== 'http:' && parsed.protocol !== 'https:';

        if (!isHttps && !isLoopbackHttp && !isPrivateUseScheme) {
          res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description:
              'redirect_uri must be https://, http://localhost (or 127.0.0.1/::1), or a private-use URI scheme',
          });
          return;
        }
      } catch (e) {
        res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'malformed redirect_uri' });
        return;
      }
    }

    const auth_method: string = body.token_endpoint_auth_method || 'none';
    const client_id = randomToken(24);
    let client_secret: string | null = null;
    let client_secret_hash: string | null = null;
    if (auth_method !== 'none') {
      client_secret = randomToken(48);
      client_secret_hash = sha256Base64Url(client_secret);
    }

    const row: OAuthClientRecord = {
      client_id,
      client_secret_hash: client_secret_hash || undefined,
      client_name: body.client_name || 'MCP Client',
      redirect_uris,
      grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
      response_types: body.response_types || ['code'],
      token_endpoint_auth_method: auth_method,
      scope: body.scope || DEFAULT_SCOPE,
      is_disabled: false,
    };
    saveOAuthClient(row);

    const out: any = {
      client_id,
      client_name: row.client_name,
      redirect_uris: row.redirect_uris,
      grant_types: row.grant_types,
      response_types: row.response_types,
      token_endpoint_auth_method: row.token_endpoint_auth_method,
      scope: row.scope,
    };
    if (client_secret) out.client_secret = client_secret;
    res.status(201).json(out);
  });

  router.get('/oauth/authorize', requireSrAccess, async (req, res) => {
    const q = req.query as any;
    const response_type = String(q.response_type || '');
    const client_id = String(q.client_id || '');
    const redirect_uri = String(q.redirect_uri || '');
    const state = String(q.state || '');
    const scope = String(q.scope || DEFAULT_SCOPE);
    const code_challenge = String(q.code_challenge || '');
    const code_challenge_method = String(q.code_challenge_method || '');

    if (response_type !== 'code') {
      res.status(400).send('unsupported_response_type');
      return;
    }
    if (!code_challenge || code_challenge_method !== 'S256') {
      res.status(400).send('PKCE S256 challenge is required');
      return;
    }

    const client = findOAuthClient(client_id);
    if (!client) {
      res.status(400).send('invalid_client');
      return;
    }
    if (!safeRedirectUri(client, redirect_uri)) {
      res.status(400).send('invalid_redirect_uri');
      return;
    }

    const leniUser = (req as any).leniUser;
    if (!leniUser) {
      res.status(401).send('unauthorized');
      return;
    }

    if (process.env.LOCAL_OAUTH_BYPASS === 'true') {
      const code = randomToken(32);
      saveAuthCode({
        code,
        client_id,
        user_id: leniUser.id,
        organisation_id: leniUser.organisationId || undefined,
        building_ids: leniUser.buildingIds,
        redirect_uri,
        scope,
        code_challenge,
        code_challenge_method,
        expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS),
        consumed: false,
      });
      const url = new URL(redirect_uri);
      url.searchParams.set('code', code);
      if (state) url.searchParams.set('state', state);
      res.redirect(302, url.toString());
      return;
    }

    const transactionId = randomToken(24);
    pendingTransactions.set(transactionId, {
      client_id,
      redirect_uri,
      state,
      scope,
      code_challenge,
      code_challenge_method,
      user_id: leniUser.id,
      organisation_id: leniUser.organisationId,
      building_ids: leniUser.buildingIds,
      user_email: leniUser.email,
      expires_at: Date.now() + AUTH_CODE_TTL_MS,
    });

    await renderConsent(req, res, {
      transactionId,
      clientName: client.client_name,
      userEmail: leniUser.email,
      scopes: scopeToHumanLines(scope),
    });
  });

  router.post('/oauth/authorize/decision', async (req, res) => {
    const body = req.body || {};
    const transactionId = String(body.transaction_id || '');
    const decision = String(body.decision || '');
    const tx = pendingTransactions.get(transactionId);
    if (!tx) {
      res.status(400).send('expired or invalid transaction');
      return;
    }
    pendingTransactions.delete(transactionId);

    if (decision !== 'allow') {
      const url = new URL(tx.redirect_uri);
      url.searchParams.set('error', 'access_denied');
      if (tx.state) url.searchParams.set('state', tx.state);
      res.redirect(302, url.toString());
      return;
    }

    const code = randomToken(32);
    saveAuthCode({
      code,
      client_id: tx.client_id,
      user_id: tx.user_id,
      organisation_id: tx.organisation_id || undefined,
      building_ids: tx.building_ids,
      redirect_uri: tx.redirect_uri,
      scope: tx.scope,
      code_challenge: tx.code_challenge,
      code_challenge_method: tx.code_challenge_method,
      expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS),
      consumed: false,
    });

    const url = new URL(tx.redirect_uri);
    url.searchParams.set('code', code);
    if (tx.state) url.searchParams.set('state', tx.state);
    res.redirect(302, url.toString());
  });

  router.post('/oauth/token', async (req, res) => {
    const body = req.body || {};
    const grant_type = String(body.grant_type || '');
    const tokenIssuer = issuer(req);

    const client = await authenticateClient(req);
    if (!client) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    if (grant_type === 'authorization_code') {
      const code = String(body.code || '');
      const code_verifier = String(body.code_verifier || '');
      const redirect_uri = String(body.redirect_uri || '');

      try {
        const codeRow = consumeAuthCode(code);
        if (!codeRow) {
          throw new GrantRejected(400, { error: 'invalid_grant' });
        }
        if (codeRow.expires_at < new Date()) {
          throw new GrantRejected(400, { error: 'invalid_grant', error_description: 'code expired' });
        }
        if (codeRow.client_id !== client.client_id) {
          throw new GrantRejected(400, { error: 'invalid_grant', error_description: 'client mismatch' });
        }
        if (codeRow.redirect_uri !== redirect_uri) {
          throw new GrantRejected(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        }
        if (!verifyPkce(code_verifier, codeRow.code_challenge, codeRow.code_challenge_method)) {
          throw new GrantRejected(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        }

        const tokens = issueTokens({
          clientId: client.client_id,
          userId: codeRow.user_id,
          organisationId: codeRow.organisation_id || null,
          buildingIds: persistedBuildingIdsToScope(codeRow.building_ids),
          scope: codeRow.scope || DEFAULT_SCOPE,
          tokenIssuer,
        });
        res.json(tokens);
      } catch (e) {
        if (e instanceof GrantRejected) {
          res.status(e.httpStatus).json(e.payload);
          return;
        }
        logger.error('[oauth] authorization_code exchange failed', e as any);
        res.status(500).json({ error: 'server_error' });
      }
      return;
    }

    if (grant_type === 'refresh_token') {
      const refresh_token = String(body.refresh_token || '');
      const hash = sha256Base64Url(refresh_token);

      try {
        const row = findRefreshToken(hash);
        if (!row || row.revoked_at || row.expires_at < new Date()) {
          throw new GrantRejected(400, { error: 'invalid_grant' });
        }
        if (row.client_id !== client.client_id) {
          throw new GrantRejected(400, { error: 'invalid_grant', error_description: 'client mismatch' });
        }

        revokeRefreshToken(hash);
        const tokens = issueTokens({
          clientId: client.client_id,
          userId: row.user_id,
          organisationId: row.organisation_id || null,
          buildingIds: persistedBuildingIdsToScope(row.building_ids),
          scope: row.scope || DEFAULT_SCOPE,
          tokenIssuer,
        });

        res.json(tokens);
      } catch (e) {
        if (e instanceof GrantRejected) {
          res.status(e.httpStatus).json(e.payload);
          return;
        }
        logger.error('[oauth] refresh_token rotation failed', e as any);
        res.status(500).json({ error: 'server_error' });
      }
      return;
    }

    res.status(400).json({ error: 'unsupported_grant_type' });
  });

  router.post('/oauth/revoke', async (req, res) => {
    const body = req.body || {};
    const token = String(body.token || '');
    if (!token) {
      res.status(200).send();
      return;
    }
    const hash = sha256Base64Url(token);
    revokeRefreshToken(hash);
    res.status(200).send();
  });

  return router;
};

class GrantRejected extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly payload: object,
  ) {
    super('grant_rejected');
    Object.setPrototypeOf(this, GrantRejected.prototype);
  }
}

const authenticateClient = async (req: Request): Promise<OAuthClientRecord | null> => {
  const body = req.body || {};
  let client_id: string | undefined = body.client_id;
  let client_secret: string | undefined = body.client_secret;

  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.indexOf('Basic ') === 0) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx > 0) {
        client_id = decodeURIComponent(decoded.slice(0, idx));
        client_secret = decodeURIComponent(decoded.slice(idx + 1));
      }
    } catch {
      /* ignore */
    }
  }
  if (!client_id) return null;

  const client = findOAuthClient(client_id);
  if (!client) return null;

  if (client.token_endpoint_auth_method === 'none') {
    return client;
  }
  if (!client_secret) return null;
  const candidate = sha256Base64Url(client_secret);
  if (!client.client_secret_hash) return null;
  if (candidate.length !== client.client_secret_hash.length) return null;
  try {
    const ok = crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(client.client_secret_hash));
    return ok ? client : null;
  } catch (e) {
    return null;
  }
};

interface IssueArgs {
  clientId: string;
  userId: string;
  organisationId: string | null;
  buildingIds: string[] | '*';
  scope: string;
  tokenIssuer: string;
}

const issueTokens = (args: IssueArgs): {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
} => {
  const jti = randomToken(16);
  const accessToken = jwt.sign(
    {
      sub: args.userId,
      org: args.organisationId,
      bids: args.buildingIds,
      scope: args.scope,
      client_id: args.clientId,
    },
    jwtSecret(),
    {
      issuer: args.tokenIssuer,
      audience: args.tokenIssuer,
      expiresIn: ACCESS_TOKEN_TTL_S,
      jwtid: jti,
    },
  );

  const refreshToken = randomToken(48);
  saveRefreshToken({
    refresh_token_hash: sha256Base64Url(refreshToken),
    client_id: args.clientId,
    user_id: args.userId,
    organisation_id: args.organisationId || undefined,
    building_ids: args.buildingIds === '*' ? ['*'] : args.buildingIds,
    scope: args.scope,
    last_access_jti: jti,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_S * 1000),
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refreshToken,
    scope: args.scope,
  };
};

export const cleanupAuthCodes = async (): Promise<void> => {
  try {
    cleanupExpiredAuthCodes();
    cleanupExpiredRefreshTokens();
  } catch (e) {
    logger.warn('[oauth] cleanup failed', e as any);
  }
};
