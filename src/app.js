const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const config = require('./config/config');
const logger = require('./utils/logger');
const swaggerSpec = require('./swagger/swagger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// ─── Route imports ────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const callsRoutes = require('./routes/calls');
const cdrRoutes = require('./routes/cdr');
const extensionsRoutes = require('./routes/extensions');
const domainsRoutes = require('./routes/domains');
const statusRoutes = require('./routes/status');

const app = express();

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  // Allow swagger-ui to load its own scripts/styles
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.cors.origins.includes(origin) || config.cors.origins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});
app.use('/api/', limiter);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Request logging ──────────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip: (req) => req.path === '/api/status',
}));

// ─── Swagger UI ───────────────────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'FusionPBX API Bridge',
  customCss: '.swagger-ui .topbar { background-color: #1e3a5f; }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
  },
}));

// Expose raw swagger JSON for CRM SDK generation
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/cdr', cdrRoutes);
app.use('/api/extensions', extensionsRoutes);
app.use('/api/domains', domainsRoutes);
app.use('/api/status', statusRoutes);

// ─── Root redirect ────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/api-docs'));

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
