// tslint:disable:no-any
// tslint:disable-next-line:no-var-requires
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
import { McpAuth } from './bearerAuth';
import { listPropertiesTool } from './tools/listProperties';
import { listKpisTool } from './tools/listKpis';
import { getKpiTool } from './tools/getKpi';
import { getRentRollTool } from './tools/getRentRoll';
import { listCubesTool } from './tools/listCubes';
import { queryCubeTool } from './tools/queryCube';
import { logToolCall } from './auditLog';
import logger from '../utils/logger';

/**
 * Build an MCP server bound to a single bearer token's scope. Each MCP
 * session creates its own server (cheap) so that the four tool handlers
 * close over the right `McpAuth` claims.
 */
export const buildMcpServer = (auth: McpAuth): any => {
  const server: any = new McpServer({
    name: 'leni-property-analytics',
    version: '0.1.0',
  });

  registerTool(server, auth, listPropertiesTool);
  registerTool(server, auth, listKpisTool);
  registerTool(server, auth, getKpiTool);
  registerTool(server, auth, getRentRollTool);
  registerTool(server, auth, listCubesTool);
  registerTool(server, auth, queryCubeTool);

  return server;
};

interface ToolDef {
  name: string;
  description: string;
  inputSchema: any;
  handler: (input: any, auth: McpAuth) => Promise<any>;
}

const registerTool = (server: any, auth: McpAuth, tool: ToolDef): void => {
  // The SDK accepts the Zod object's `.shape` to build a JSON schema.
  const shape = tool.inputSchema && tool.inputSchema.shape ? tool.inputSchema.shape : {};

  server.tool(
    tool.name,
    tool.description,
    shape,
    async (rawInput: any) => {
      const start = Date.now();
      let statusCode = 200;
      let rowCount = 0;
      let errorMessage: string | undefined;
      try {
        // Validate input through Zod (defensive — SDK already does this).
        const parsed = tool.inputSchema.parse(rawInput || {});
        const result = await tool.handler(parsed, auth);
        if (result && typeof result.rowCount === 'number') rowCount = result.rowCount;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        statusCode = err && err.statusCode ? err.statusCode : 500;
        errorMessage = err && err.message ? String(err.message) : 'Unknown error';
        logger.warn(`[mcp.tool:${tool.name}] error`, { errorMessage });
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Tool error: ${errorMessage}`,
            },
          ],
        };
      } finally {
        const latency = Date.now() - start;
        logToolCall({
          auth,
          toolName: tool.name,
          toolInput: rawInput,
          statusCode,
          latencyMs: latency,
          rowCount,
          errorMessage,
        }).catch((): void => undefined);
      }
    },
  );
};
