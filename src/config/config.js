require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
  },

  auth: {
    jwtSecret:    process.env.JWT_SECRET     || 'change-this-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',

    // Bootstrap admin key (env only).
    // Used for initial setup before any DB keys exist, and for admin operations.
    // Leave empty to require all access through DB-managed keys.
    adminApiKey: process.env.ADMIN_API_KEY || null,

    // Key cache TTL in milliseconds (default 5 minutes).
    // Reduces DB hits: a revoked key stays valid at most this long.
    keyCacheTtl: parseInt(process.env.KEY_CACHE_TTL_MS, 10) || 5 * 60 * 1000,
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
    host:                process.env.ESL_HOST     || 'localhost',
    port:                parseInt(process.env.ESL_PORT, 10) || 8021,
    password:            process.env.ESL_PASSWORD || 'ClueCon',
    reconnectDelay:      5000,
    maxReconnectAttempts: 10,
  },

  db: {
    host:                    process.env.DB_HOST || 'localhost',
    port:                    parseInt(process.env.DB_PORT, 10) || 5432,
    database:                process.env.DB_NAME || 'fusionpbx',
    user:                    process.env.DB_USER || 'fusionpbx',
    password:                process.env.DB_PASSWORD || '',
    ssl:                     process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max:                     10,
    idleTimeoutMillis:       30000,
    connectionTimeoutMillis: 5000,
  },

  smtp: {
    host:   process.env.SMTP_HOST   || '',
    port:   parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user:   process.env.SMTP_USER   || '',
    pass:   process.env.SMTP_PASS   || '',
    from:   process.env.SMTP_FROM   || 'Private Call <no-reply@private.voipat.com>',
  },

  // Self-service signup (email-verified) settings.
  signup: {
    // Domain new users are provisioned under.
    domain: process.env.SIGNUP_DOMAIN || 'private.voipat.com',
    // WSS signaling URL handed back to the app for this domain.
    signalingServer: process.env.SIGNUP_SIGNALING || 'wss://private.voipat.com:7443/ws',
    // FusionPBX defaults applied to newly-created extensions.
    context:         process.env.SIGNUP_EXT_CONTEXT || 'private.voipat.com',
    outboundCallerId: process.env.SIGNUP_OUTBOUND_CID || '',
    // Optional shared TURN handed to the app.
    stunServer: process.env.SIGNUP_STUN || 'stun:stun.l.google.com:19302',
    turnServer: process.env.SIGNUP_TURN || '',
    turnUsername: process.env.SIGNUP_TURN_USER || '',
    turnPassword: process.env.SIGNUP_TURN_PASS || '',
  },

  // Google Sign-In. GOOGLE_CLIENT_IDS is a comma-separated allow-list of OAuth
  // client IDs accepted as the ID token's `aud` (so Android + web can differ).
  google: {
    clientIds: (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    // Auto-create the extension on /auth/google/signin if it doesn't exist yet.
    // Keeps first-time Google users from hitting a dead end when they tap "Sign in".
    autoProvisionOnSignin: process.env.GOOGLE_AUTOPROVISION !== 'false',
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
