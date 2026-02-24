require('dotenv').config();

/**
 * Parse DOMAIN_API_KEYS env var.
 * Format:  domain1.com:secretkey1,domain2.com:secretkey2
 *
 * Returns:
 *   keyToDomain  { apiKey  -> domain }  – used by auth middleware (fast key lookup)
 *   domainToKey  { domain  -> apiKey }  – used by /auth/token endpoint
 */
function parseDomainKeys(raw) {
  const keyToDomain = {};
  const domainToKey = {};
  if (!raw || !raw.trim()) return { keyToDomain, domainToKey };

  raw.split(',').forEach((pair) => {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) return;
    const domain = pair.slice(0, colonIdx).trim();
    const key    = pair.slice(colonIdx + 1).trim();
    if (domain && key) {
      keyToDomain[key]    = domain;
      domainToKey[domain] = key;
    }
  });
  return { keyToDomain, domainToKey };
}

const { keyToDomain, domainToKey } = parseDomainKeys(process.env.DOMAIN_API_KEYS || '');

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
  },

  auth: {
    jwtSecret:   process.env.JWT_SECRET    || 'change-this-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',

    // Per-domain keys:  { apiKey -> domain }
    // Each CRM tenant has its own key and is locked to its domain only.
    keyToDomain,

    // Reverse map:  { domain -> apiKey }
    // Used to validate the correct key was supplied for a domain at /auth/token.
    domainToKey,

    // Optional admin key – bypasses domain lock, can access every domain.
    // Leave empty / unset to disable admin access.
    adminApiKey: process.env.ADMIN_API_KEY || null,
  },

  fusionpbx: {
    host:     process.env.FUSIONPBX_HOST     || 'localhost',
    port:     parseInt(process.env.FUSIONPBX_PORT, 10) || 443,
    protocol: process.env.FUSIONPBX_PROTOCOL || 'https',
    username: process.env.FUSIONPBX_USERNAME || 'admin',
    password: process.env.FUSIONPBX_PASSWORD || '',
    get baseUrl() {
      return `${this.protocol}://${this.host}:${this.port}`;
    },
  },

  esl: {
    host:               process.env.ESL_HOST     || 'localhost',
    port:               parseInt(process.env.ESL_PORT, 10) || 8021,
    password:           process.env.ESL_PASSWORD || 'ClueCon',
    reconnectDelay:     5000,
    maxReconnectAttempts: 10,
  },

  db: {
    host:                   process.env.DB_HOST || 'localhost',
    port:                   parseInt(process.env.DB_PORT, 10) || 5432,
    database:               process.env.DB_NAME || 'fusionpbx',
    user:                   process.env.DB_USER || 'fusionpbx',
    password:               process.env.DB_PASSWORD || '',
    ssl:                    process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max:                    10,
    idleTimeoutMillis:      30000,
    connectionTimeoutMillis: 5000,
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim()),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max:      parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file:  process.env.LOG_FILE  || 'logs/app.log',
  },
};

module.exports = config;
