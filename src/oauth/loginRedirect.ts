import { Request } from 'express';

type IssuerRequest = Pick<Request, 'protocol' | 'get'>;

const fallbackIssuer = (): string =>
  (process.env.MCP_ISSUER || process.env.APP_URL || process.env.API_GATEWAY || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );

const isBrowserReachableHost = (host: string): boolean => {
  const h = host.toLowerCase();
  if (h.startsWith('localhost') || h.startsWith('127.0.0.1') || h.startsWith('[::1]')) return true;
  // Docker Compose DNS names are not valid OAuth/MCP URLs for Cursor or the browser.
  if (
    h.includes('user-service') ||
    h.includes('auth-service') ||
    h.includes('leni-mcp-connector') ||
    h.includes('api-gateway')
  ) {
    return false;
  }
  return true;
};

const isLoopbackUrl = (url: string): boolean => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
};

/** Public base URL from the incoming request (ngrok, Railway, localhost:3050). */
const issuerFromRequest = (req?: IssuerRequest): string | null => {
  if (!req?.get) return null;
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  if (!host || !isBrowserReachableHost(host)) return null;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  return `${proto}://${host}`.replace(/\/$/, '');
};

/**
 * OAuth authorization server issuer (RFC 8414). Pinned to MCP_ISSUER / gateway —
 * never the ngrok host. Browser opens gateway/oauth/authorize, then redirects to
 * APP_URL/login when the user is not signed in.
 */
export const oauthIssuer = (req?: IssuerRequest): string => {
  const pinned = process.env.MCP_ISSUER?.trim()?.replace(/\/$/, '');
  if (pinned) return pinned;
  const fromRequest = issuerFromRequest(req);
  if (fromRequest) return fromRequest;
  return fallbackIssuer();
};

/** @deprecated alias — use oauthIssuer for JWT iss/aud and OAuth discovery */
export const connectorIssuer = oauthIssuer;

/** Ensure the MCP resource identifier ends with `/mcp` (MCP + RFC 9728). */
const withMcpPath = (base: string): string => {
  const trimmed = base.replace(/\/$/, '');
  return trimmed.endsWith('/mcp') ? trimmed : `${trimmed}/mcp`;
};

/**
 * MCP resource URL (RFC 9728) — the Streamable HTTP endpoint clients POST to.
 * Set MCP_RESOURCE_URL explicitly when tunneling (e.g. ngrok …/mcp).
 */
export const connectorResourceUrl = (req?: IssuerRequest): string => {
  const pinnedResource = process.env.MCP_RESOURCE_URL?.trim();
  if (pinnedResource) return withMcpPath(pinnedResource);

  const pinnedGateway = process.env.API_GATEWAY?.trim()?.replace(/\/$/, '');
  const fromRequest = issuerFromRequest(req);

  // ngrok/Railway: public tunnel host while API_GATEWAY is still loopback in .env
  if (fromRequest && pinnedGateway && isLoopbackUrl(pinnedGateway) && !isLoopbackUrl(fromRequest)) {
    return withMcpPath(fromRequest);
  }
  if (pinnedGateway && isBrowserReachableHost(new URL(pinnedGateway).hostname)) {
    return withMcpPath(pinnedGateway);
  }
  if (fromRequest) return withMcpPath(fromRequest);
  return withMcpPath(oauthIssuer(req));
};

/**
 * RFC 9728 §3.1 — well-known URL for a resource that includes a path (e.g. /mcp).
 * http://host:8088/mcp → http://host:8088/.well-known/oauth-protected-resource/mcp
 */
export const protectedResourceMetadataUrl = (resourceUrl?: string): string => {
  const resource = (resourceUrl || connectorResourceUrl()).replace(/\/$/, '');
  try {
    const u = new URL(resource);
    const path = u.pathname.replace(/^\//, '');
    if (path) {
      return `${u.origin}/.well-known/oauth-protected-resource/${path}`;
    }
    return `${u.origin}/.well-known/oauth-protected-resource`;
  } catch {
    return `${resource}/.well-known/oauth-protected-resource`;
  }
};

/** Full URL for the in-progress authorize request (always on the OAuth issuer / gateway). */
export const buildConnectorAuthorizeUrl = (req: Request): string => {
  const base = oauthIssuer(req);
  const path = (req.originalUrl || '/oauth/authorize').split('#')[0];
  const suffix = path.startsWith('/oauth') ? path : '/oauth/authorize';
  const url = new URL(suffix, `${base}/`);
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    const canonical = new URL(base);
    url.protocol = canonical.protocol;
    url.host = canonical.host;
  }
  return url.toString();
};

/**
 * Leni frontend login, then back to gateway/oauth/authorize (not ngrok).
 */
export const buildLoginRedirectUrl = (req: Request): string => {
  const appUrl = (process.env.APP_URL || 'https://app.leni.co').replace(/\/$/, '');
  const authorizeUrl = buildConnectorAuthorizeUrl(req);
  return `${appUrl}/login?redirect=${encodeURIComponent(authorizeUrl)}`;
};
