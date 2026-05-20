/**
 * Central MCP SDK imports so Vercel's file tracer includes dist/cjs/server/* in the bundle.
 * Avoid deep `require('@modelcontextprotocol/sdk/server/...')` in other modules.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export { McpServer, StreamableHTTPServerTransport };
