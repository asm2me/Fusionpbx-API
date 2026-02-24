/**
 * FusionPBX API Bridge - Entry Point
 *
 * Starts:
 *  1. Express HTTP server
 *  2. WebSocket server (mounted on same HTTP server at /ws)
 *  3. FreeSWITCH ESL connection
 *  4. PostgreSQL connection pool
 */

require('dotenv').config();

const http = require('http');
const app = require('./src/app');
const config = require('./src/config/config');
const logger = require('./src/utils/logger');
const eslService = require('./src/services/eslService');
const dbService = require('./src/services/dbService');
const wsService = require('./src/services/wsService');

async function start() {
  // ── 1. Create HTTP server ──────────────────────────────────────────────────
  const server = http.createServer(app);

  // ── 2. Initialize WebSocket server ────────────────────────────────────────
  wsService.init(server);

  // ── 3. Initialize DB pool ─────────────────────────────────────────────────
  try {
    dbService.init();
    const dbOk = await dbService.testConnection();
    if (dbOk) {
      logger.info('Database connection verified');
    } else {
      logger.warn('Database connection test failed - CDR queries will not work');
    }
  } catch (err) {
    logger.warn('Database initialization error', { error: err.message });
  }

  // ── 4. Connect to FreeSWITCH ESL ──────────────────────────────────────────
  try {
    await eslService.connect();
    logger.info('FreeSWITCH ESL connected', {
      host: config.esl.host,
      port: config.esl.port,
    });
  } catch (err) {
    logger.warn('ESL initial connection failed - will retry automatically', {
      error: err.message,
    });
  }

  // ── 5. Start HTTP server ───────────────────────────────────────────────────
  server.listen(config.server.port, () => {
    logger.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FusionPBX API Bridge started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HTTP API:   http://localhost:${config.server.port}/api
  Swagger UI: http://localhost:${config.server.port}/api-docs
  WebSocket:  ws://localhost:${config.server.port}/ws
  ESL:        ${config.esl.host}:${config.esl.port}
  DB:         ${config.db.host}:${config.db.port}/${config.db.database}
  Env:        ${config.server.env}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      eslService.disconnect();
      await dbService.close();
      logger.info('Server closed');
      process.exit(0);
    });
    // Force close after 10s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
