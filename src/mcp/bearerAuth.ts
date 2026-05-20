import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { isAccessJtiRevoked } from '../oauth/memoryStore';
import { connectorIssuer, protectedResourceMetadataUrl } from '../oauth/loginRedirect';
import logger from '../utils/logger';

/**
 * Bearer-token middleware for the MCP listener. Verifies the JWT signed by
 * MCP_JWT_SECRET and attaches scope claims to `req.mcpAuth` for downstream tools.
 */

export interface McpAuth {
  userId: string;
  organisationId: string | null;
  buildingIds: string[] | '*';
  scope: string;
  clientId: string;
  jti: string;
}

declare module 'express' {
  // tslint:disable-next-line:interface-name
  interface Request {
    mcpAuth?: McpAuth;
  }
}

const wwwAuthenticate = (tokenIssuer: string, error?: string): string => {
  const parts = [
    `Bearer realm="${tokenIssuer}"`,
    `resource_metadata="${protectedResourceMetadataUrl()}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  return parts.join(', ');
};

const invalidTokenClaims = (res: Response, issuer: string): void => {
  res.setHeader('WWW-Authenticate', wwwAuthenticate(issuer, 'invalid_token'));
  res.status(401).json({ error: 'invalid_token', error_description: 'invalid token claims' });
};

/** Ensure decoded access-token payload matches what MCP tools expect. */
const parseMcpClaims = (decoded: any): McpAuth | null => {
  if (typeof decoded.sub !== 'string' || decoded.sub.length === 0) return null;
  if (typeof decoded.client_id !== 'string' || decoded.client_id.length === 0) return null;
  if (typeof decoded.jti !== 'string' || decoded.jti.length === 0) return null;

  let organisationId: string | null = null;
  if (decoded.org !== undefined && decoded.org !== null) {
    if (typeof decoded.org !== 'string') return null;
    organisationId = decoded.org.length > 0 ? decoded.org : null;
  }

  let buildingIds: string[] | '*';
  if (decoded.bids === '*') {
    buildingIds = '*';
  } else if (Array.isArray(decoded.bids)) {
    if (!decoded.bids.every((x: unknown) => typeof x === 'string')) return null;
    buildingIds = decoded.bids as string[];
  } else {
    return null;
  }

  let scope = '';
  if (decoded.scope !== undefined && decoded.scope !== null) {
    if (typeof decoded.scope !== 'string') return null;
    scope = decoded.scope;
  }

  return {
    userId: decoded.sub,
    organisationId,
    buildingIds,
    scope,
    clientId: decoded.client_id,
    jti: decoded.jti,
  };
};

export const bearerAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const issuer = connectorIssuer(req);
  const secret = process.env.MCP_JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'server_misconfigured' });
    return;
  }

  const header = req.headers['authorization'];
  if (typeof header !== 'string' || header.indexOf('Bearer ') !== 0) {
    res.setHeader('WWW-Authenticate', wwwAuthenticate(issuer));
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  const token = header.slice(7);

  try {
    const decoded: any = jwt.verify(token, secret, {
      issuer,
      audience: issuer,
    });

    const mcpAuth = parseMcpClaims(decoded);
    if (!mcpAuth) {
      invalidTokenClaims(res, issuer);
      return;
    }

    if (isAccessJtiRevoked(mcpAuth.jti)) {
      res.setHeader('WWW-Authenticate', wwwAuthenticate(issuer, 'invalid_token'));
      res.status(401).json({ error: 'invalid_token', error_description: 'token revoked' });
      return;
    }

    req.mcpAuth = mcpAuth;
    next();
  } catch (err) {
    logger.warn('[bearerAuth] JWT verification failed', err as any);
    res.setHeader('WWW-Authenticate', wwwAuthenticate(issuer, 'invalid_token'));
    res.status(401).json({ error: 'invalid_token' });
  }
};
