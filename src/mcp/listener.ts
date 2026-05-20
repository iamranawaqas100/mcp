// tslint:disable:no-any
import express, { NextFunction, Request, Response } from 'express';
// tslint:disable-next-line:no-var-requires
const cookieParser = require('cookie-parser');
// tslint:disable-next-line:no-var-requires
const helmet = require('helmet');
import { buildMcpRouter } from './transport';
import { buildOAuthRouter, cleanupAuthCodes } from '../oauth/authorizationServer';
import logger from '../utils/logger';

/**
 * Second HTTP listener (default port 3050) hosting only the public-internet
 * surface for the Claude / MCP connector:
 *
 *   - POST/GET/DELETE /mcp                              (Streamable HTTP MCP)
 *   - /oauth/{register,authorize,token,revoke,authorize/decision}
 *   - /.well-known/oauth-{authorization-server,protected-resource}
 *
 * The internal user-service API on PORT (3001/3010) is unaffected.
 */
export const startConnectorListener = (): void => {
  // Production safety guard: LOCAL_OAUTH_BYPASS injects a hardcoded test user
  // and skips the consent screen. It must never be active outside development.
  if (
    process.env.LOCAL_OAUTH_BYPASS === 'true' &&
    process.env.NODE_ENV !== 'development' &&
    process.env.NODE_ENV !== 'dev' &&
    process.env.NODE_ENV !== 'test'
  ) {
    throw new Error(
      'FATAL: LOCAL_OAUTH_BYPASS=true is forbidden when NODE_ENV is not development/dev/test. ' +
        'Refusing to start the connector.',
    );
  }

  const app = express();

  // Trust the API gateway's X-Forwarded-* headers (HTTPS termination etc.)
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  }));
  app.use(cookieParser());

  // CORS — Claude.ai and the MCP Inspector UI hit /.well-known/*, /oauth/*,
  // and /mcp directly from the browser, so we must reflect the origin and
  // handle the preflight. The `enforceOriginCheck` in transport.ts still
  // gates /mcp itself; this middleware just makes the preflight pass.
  const appOrigin = (() => {
    try {
      const u = process.env.APP_URL || '';
      return u ? new URL(u).origin : '';
    } catch {
      return '';
    }
  })();

  const allowedOrigins = (
    process.env.MCP_ALLOWED_ORIGINS ||
    'https://claude.ai,https://www.claude.ai,http://localhost:6274,http://127.0.0.1:6274'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (appOrigin && allowedOrigins.indexOf(appOrigin) === -1) {
    allowedOrigins.push(appOrigin);
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin as string | undefined;
    if (origin && allowedOrigins.indexOf(origin) !== -1) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Mcp-Session-Id, mcp-protocol-version, Accept',
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Health probe for the gateway / load balancer.
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'leni-mcp-connector' });
  });

  // MCP first — must not pass through OAuth router's body-parser (Streamable HTTP needs raw body).
  app.use('/', buildMcpRouter());

  // OAuth + discovery (mounted at root because the spec demands fixed paths).
  app.use('/', buildOAuthRouter());

  // Generic JSON 404.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Generic error handler.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('[connector-listener] unhandled error', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error' });
    }
  });

  const DEFAULT_PORT = 3050;
  const resolveConnectorPort = (): number => {
    // Railway and most PaaS set PORT; MCP_PORT overrides for local/docker parity.
    const raw = process.env.MCP_PORT || process.env.PORT;
    if (raw === undefined || String(raw).trim() === '') {
      return DEFAULT_PORT;
    }
    const n = Number.parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
      logger.error(
        `[connector-listener] invalid port "${raw}" (expected integer 1-65535); using ${DEFAULT_PORT}`,
      );
      return DEFAULT_PORT;
    }
    return n;
  };

  const port = resolveConnectorPort();
  app.listen(port, () => {
    logger.info(`[connector-listener] listening on port ${port}`);
  });

  // Periodic cleanup of expired auth codes (every 10 min).
  setInterval(() => {
    cleanupAuthCodes().catch(() => undefined);
  }, 10 * 60 * 1000).unref();
};
