require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'change-this-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
    apiKey: process.env.API_KEY || 'change-this-api-key',
  },

  fusionpbx: {
    host: process.env.FUSIONPBX_HOST || 'localhost',
    port: parseInt(process.env.FUSIONPBX_PORT, 10) || 443,
    protocol: process.env.FUSIONPBX_PROTOCOL || 'https',
    username: process.env.FUSIONPBX_USERNAME || 'admin',
    password: process.env.FUSIONPBX_PASSWORD || '',
    domain: process.env.FUSIONPBX_DOMAIN || '',
    get baseUrl() {
      return `${this.protocol}://${this.host}:${this.port}`;
    },
  },

  esl: {
    host: process.env.ESL_HOST || 'localhost',
    port: parseInt(process.env.ESL_PORT, 10) || 8021,
    password: process.env.ESL_PASSWORD || 'ClueCon',
    reconnectDelay: 5000,
    maxReconnectAttempts: 10,
  },

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'fusionpbx',
    user: process.env.DB_USER || 'fusionpbx',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim()),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/app.log',
  },
};

module.exports = config;
