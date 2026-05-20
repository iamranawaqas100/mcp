import 'dotenv/config';
import { serviceName } from './config';
import { startConnectorListener } from './mcp/listener';
import logger from './utils/logger';

const requiredEnv = ['MCP_JWT_SECRET', 'JWT_ACCESS_SECRET'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    logger.error(`[${serviceName}] missing required env: ${key}`);
    process.exit(1);
  }
}

try {
  startConnectorListener();
} catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);
  logger.error(`[connector] failed to start: ${errMsg}`);
  process.exit(1);
}

logger.info(`[${serviceName}] ready`);
