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
const authRoutes       = require('./routes/auth');
const apikeysRoutes    = require('./routes/apikeys');
const callsRoutes      = require('./routes/calls');
const cdrRoutes        = require('./routes/cdr');
const extensionsRoutes = require('./routes/extensions');
const domainsRoutes    = require('./routes/domains');
const statusRoutes     = require('./routes/status');
const ticketsRoutes    = require('./routes/tickets');

const app = express();

// Behind nginx: trust the first proxy hop so req.ip / X-Forwarded-For and
// express-rate-limit work correctly.
app.set('trust proxy', 1);

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
app.use('/api/auth',    authRoutes);
app.use('/api/apikeys', apikeysRoutes);
app.use('/api/calls',  callsRoutes);
app.use('/api/cdr', cdrRoutes);
app.use('/api/extensions', extensionsRoutes);
app.use('/api/domains', domainsRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/tickets', ticketsRoutes);

// ─── Root redirect ────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/api-docs'));

// ─── Virtual ID landing page ──────────────────────────────────────────────────
// https://voipat.com/id/<alias>  (nginx proxies /id/ here). If the Private Call
// app is installed it intercepts this URL as an Android App Link and this page is
// never shown. Otherwise we render a page that (a) tries the app via a deep link
// and (b) offers the download.
const PLAY_URL = process.env.APP_PLAY_URL || 'https://play.google.com/store/apps/details?id=com.pvtcall.app';
// Direct APK download (Android sideload). Served from this box by default.
const APK_URL  = process.env.APP_APK_URL  || 'https://private.voipat.com/dl/PrivateCall.apk';
app.get('/id/:alias', (req, res) => {
  const alias = String(req.params.alias || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
  const isAndroid = /android/i.test(req.get('user-agent') || '');

  // Android gets both: a direct APK download AND Google Play. Other platforms
  // just get Play (APK is Android-only).
  const dlBtns = isAndroid
    ? `<a class="btn" href="${APK_URL}">Download APK (Android)</a>
       <a class="btn alt" href="${PLAY_URL}">Get it on Google Play</a>`
    : `<a class="btn" href="${PLAY_URL}">Get it on Google Play</a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Private Call — Virtual ID</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0F0F12;color:#eee;margin:0;
       display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{max-width:420px;text-align:center}
  .id{font-size:20px;font-weight:700;color:#B794F6;word-break:break-all;margin:10px 0 4px}
  .muted{color:#9aa;font-size:14px;line-height:1.5}
  .btn{display:inline-block;margin-top:18px;padding:14px 20px;border-radius:12px;
       background:#7C3AED;color:#fff;text-decoration:none;font-weight:600}
  .btn.alt{background:#2A2A30;margin-top:10px}
  h1{font-size:22px;margin:0 0 6px}
</style></head>
<body><div class="card">
  <h1>Reach this Virtual ID on Private Call</h1>
  <div class="id">${alias || 'Virtual ID'}</div>
  <p class="muted">If you have the Private Call app, it should open automatically.
     If not, install it — then reopen this link to connect.</p>
  ${dlBtns}
  <a class="btn alt" href="https://private.voipat.com/id/${alias}">I already have the app — open it</a>
</div>
<script>
  // Best-effort: nudge the App Link. On installed devices Android usually
  // intercepts before this page loads; this is a fallback for edge cases.
  // (No auto-redirect to a custom scheme to avoid error pages when not installed.)
</script>
</body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

// ─── Chat media upload (hybrid transport, large files) ─────────────────────────
// The app POSTs raw file bytes (Content-Type = the media mime, X-File-Name header
// with the original name). We store it and return a public URL under /media/.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MEDIA_DIR = process.env.MEDIA_DIR || '/var/www/media';
const MEDIA_BASE = process.env.MEDIA_PUBLIC_BASE || 'https://private.voipat.com/media';
try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch { /* ignore */ }

app.post('/media/upload',
  express.raw({ type: () => true, limit: '25mb' }),
  (req, res) => {
    try {
      if (!req.body || !req.body.length) {
        return res.status(400).json({ error: 'Empty upload.' });
      }
      const orig = String(req.get('x-file-name') || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      const ext = path.extname(orig) || '';
      const id = crypto.randomBytes(12).toString('hex');
      const fname = `${id}${ext}`;
      fs.writeFileSync(path.join(MEDIA_DIR, fname), req.body);
      return res.json({ url: `${MEDIA_BASE}/${fname}`, size: req.body.length });
    } catch (err) {
      logger.error('media upload failed', { error: err.message });
      return res.status(500).json({ error: 'Upload failed.' });
    }
  });

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
