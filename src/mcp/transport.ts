// tslint:disable:no-any
import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { StreamableHTTPServerTransport } from './mcpSdk';
import { bearerAuth } from './bearerAuth';
import { buildMcpServer } from './server';
import logger from '../utils/logger';

const randomUUID = (): string => {
  // Polyfill for Node <14.17 / @types/node that lacks crypto.randomUUID typing.
  const bytes = crypto.randomBytes(16);
  // tslint:disable-next-line:no-bitwise
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // tslint:disable-next-line:no-bitwise
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};

/**
 * Express router that exposes a Streamable HTTP MCP endpoint at `POST /mcp`,
 * with `GET /mcp` for SSE notifications and `DELETE /mcp` for session
 * termination, per the MCP spec.
 *
 * Sessions are identified by the `Mcp-Session-Id` response header on the
 * initialize response and echoed by clients on subsequent requests.
 */

interface ActiveSession {
  transport: any;
  serverInitialized: boolean;
  /** SHA-256 of the raw bearer token used at session init; prevents session-id reuse across identities. */
  tokenSha256: string;
}

const sessions: Map<string, ActiveSession> = new Map();

const bearerTokenFingerprint = (req: Request): string => {
  const raw = req.headers['authorization'];
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const m = trimmed.match(/^Bearer\s+(.+)$/i);
  if (!m || !m[1]) return '';
  let token = m[1].trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  if (!token) return '';
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
};

export const buildMcpRouter = (): Router => {
  const router = Router();

  // Do NOT mount body-parser here — StreamableHTTPServerTransport reads the raw body.

  router.post('/mcp', bearerAuth, async (req: Request, res: Response) => {
    try {
      enforceOriginCheck(req, res);
      if (res.headersSent) return;

      const sessionIdHeader = req.headers['mcp-session-id'] as string | undefined;
      let session = sessionIdHeader ? sessions.get(sessionIdHeader) : undefined;

      if (!session) {
        const tokenSha256 = bearerTokenFingerprint(req);
        if (!tokenSha256) {
          res.status(401).json({ error: 'invalid_token' });
          return;
        }
        // New session. The SDK assigns the session id during handleRequest()
        // (when the initialize message is processed), so we must register the
        // session inside onsessioninitialized — not before. Otherwise the
        // follow-up POST (carrying Mcp-Session-Id) finds nothing in the map
        // and we mint a fresh, uninitialized transport.
        let createdTransport: any;
        createdTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, { transport: createdTransport, serverInitialized: true, tokenSha256 });
            logger.info(`[mcp] session initialized ${sid}`);
          },
        });
        createdTransport.onclose = () => {
          const sid = createdTransport.sessionId;
          if (sid) sessions.delete(sid);
        };
        const server = buildMcpServer(req.mcpAuth!);
        await (server as any).connect(createdTransport);
        await createdTransport.handleRequest(req, res, req.body);
      } else {
        const fp = bearerTokenFingerprint(req);
        if (!fp || fp !== session.tokenSha256) {
          res.status(401).json({
            error: 'invalid_token',
            error_description: 'session does not match bearer token',
          });
          return;
        }
        await session.transport.handleRequest(req, res, req.body);
      }
    } catch (err) {
      logger.error('[mcp] POST /mcp error', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: err && err.message ? err.message : 'internal error' },
          id: null,
        });
      }
    }
  });

  // GET /mcp -> SSE stream for server-initiated notifications.
  router.get('/mcp', bearerAuth, async (req: Request, res: Response) => {
    try {
      const sid = req.headers['mcp-session-id'] as string | undefined;
      if (!sid) {
        res.status(400).json({ error: 'Mcp-Session-Id required' });
        return;
      }
      const session = sessions.get(sid);
      if (!session) {
        res.status(404).json({ error: 'Unknown session' });
        return;
      }
      const fp = bearerTokenFingerprint(req);
      if (!fp || fp !== session.tokenSha256) {
        res.status(401).json({
          error: 'invalid_token',
          error_description: 'session does not match bearer token',
        });
        return;
      }
      await session.transport.handleRequest(req, res);
    } catch (err) {
      logger.error('[mcp] GET /mcp error', err);
      if (!res.headersSent) res.status(500).end();
    }
  });

  // DELETE /mcp -> close session.
  router.delete('/mcp', bearerAuth, async (req: Request, res: Response) => {
    const sid = req.headers['mcp-session-id'] as string | undefined;
    if (!sid) {
      res.status(400).json({ error: 'Mcp-Session-Id required' });
      return;
    }
    const session = sessions.get(sid);
    if (session) {
      const fp = bearerTokenFingerprint(req);
      if (!fp || fp !== session.tokenSha256) {
        res.status(401).json({
          error: 'invalid_token',
          error_description: 'session does not match bearer token',
        });
        return;
      }
      try {
        await session.transport.close();
      } catch (e) { /* ignore */ }
      sessions.delete(sid);
    }
    res.status(204).end();
  });

  return router;
};

const enforceOriginCheck = (req: Request, res: Response): void => {
  const origin = req.headers['origin'];
  if (!origin) return; // non-browser clients (curl, MCP Inspector) often omit Origin
  const allowed = (process.env.MCP_ALLOWED_ORIGINS || 'https://claude.ai,https://www.claude.ai')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.indexOf(String(origin)) === -1) {
    res.status(403).json({ error: 'origin_not_allowed', origin });
  }
};
