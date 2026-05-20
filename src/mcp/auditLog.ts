import { McpAuth } from './bearerAuth';
import logger from '../utils/logger';

/** Structured audit log (no database). Wire to a backend logging API later if needed. */
export const logToolCall = async (params: {
  auth: McpAuth;
  toolName: string;
  toolInput: any;
  statusCode: number;
  latencyMs: number;
  rowCount: number;
  errorMessage?: string;
}): Promise<void> => {
  logger.info('[mcp.audit]', {
    user_id: params.auth.userId,
    organisation_id: params.auth.organisationId,
    client_id: params.auth.clientId,
    tool_name: params.toolName,
    status_code: params.statusCode,
    latency_ms: params.latencyMs,
    row_count: params.rowCount,
    error_message: params.errorMessage,
  });
};
