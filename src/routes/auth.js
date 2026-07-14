const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { validate }       = require('../middleware/validate');
const { authenticate, generateToken } = require('../middleware/auth');
const dbService          = require('../services/dbService');
const fusionpbxService   = require('../services/fusionpbxService');
const otpService         = require('../services/otpService');
const mailService        = require('../services/mailService');
const googleAuthService  = require('../services/googleAuthService');
const config             = require('../config/config');
const logger             = require('../utils/logger');

const router = express.Router();

// Strict limiter for the public, unauthenticated signup endpoints.
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Please try again later.' },
});

// Username used as the SIP extension. Keep it conservative so it maps cleanly
// to a FusionPBX extension number/AOR.
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

function buildAccountResponse(username, password, displayName) {
  const s = config.signup;
  return {
    username,
    password,
    domain: s.domain,
    signaling_server: s.signalingServer,
    display_name: displayName || username,
    stun_server: s.stunServer,
    turn_server: s.turnServer,
    turn_username: s.turnUsername,
    turn_password: s.turnPassword,
  };
}

/**
 * POST /api/auth/token
 *
 * Exchange an API key (DB-backed or bootstrap admin) for a short-lived JWT.
 *
 * Domain-key:
 *   { "api_key": "fpx_abc123..." }
 *   → domain is resolved automatically from the DB record
 *
 * Bootstrap admin key:
 *   { "api_key": "<ADMIN_API_KEY>", "domain": "company.com" }
 *   → issues a JWT scoped to the specified domain
 */
router.post(
  '/token',
  [body('api_key').notEmpty().withMessage('api_key is required')],
  validate,
  async (req, res) => {
    try {
      const { api_key, domain: bodyDomain } = req.body;

      // ── Bootstrap admin key ────────────────────────────────────────────────
      if (config.auth.adminApiKey && api_key === config.auth.adminApiKey) {
        const token = generateToken({
          userId: 'admin',
          domain: bodyDomain || null,
          admin:  true,
          scope:  'full',
        });
        logger.info('Admin JWT issued', { domain: bodyDomain || 'all', ip: req.ip });
        return res.json({
          token,
          expires_in: config.auth.jwtExpiresIn,
          token_type: 'Bearer',
          domain:     bodyDomain || null,
        });
      }

      // ── DB-backed domain key ───────────────────────────────────────────────
      const keyData = await dbService.lookupApiKey(api_key);
      if (!keyData) {
        logger.warn('Token request with invalid API key', { ip: req.ip });
        return res.status(401).json({ error: 'Invalid API key' });
      }

      const token = generateToken({
        userId:  keyData.username,
        userUuid: keyData.user_uuid,
        domain:  keyData.domain_name,
        admin:   keyData.is_admin,
        scope:   'full',
      });

      logger.info('JWT issued', { domain: keyData.domain_name, user: keyData.username, ip: req.ip });
      res.json({
        token,
        expires_in: config.auth.jwtExpiresIn,
        token_type: 'Bearer',
        domain:     keyData.domain_name,
        username:   keyData.username,
      });
    } catch (err) {
      logger.error('Token generation error', { error: err.message });
      res.status(500).json({ error: 'Token generation failed' });
    }
  }
);

/**
 * GET /api/auth/verify
 * Verify credentials and return the resolved user + domain context.
 */
router.get('/verify', authenticate, (req, res) => {
  res.json({ valid: true, user: req.user, domain: req.domain });
});

// ─── Self-service signup (email-verified) ──────────────────────────────────────
//
// Two-step flow:
//   1. POST /register/start   { email, username, password } → emails an OTP
//   2. POST /register/verify  { email, code }               → creates the
//      extension in FusionPBX and returns SIP credentials.
//
// Duplicate protection: the username must be unique as an extension in the
// signup domain (checked at both start and verify).

/**
 * POST /api/auth/register/start
 * Validates input, rejects duplicate usernames, and emails a verification code.
 */
router.post(
  '/register/start',
  signupLimiter,
  [
    body('email').isEmail().withMessage('valid email is required').normalizeEmail(),
    body('username')
      .custom((v) => USERNAME_RE.test(String(v || '').toLowerCase()))
      .withMessage('username must be 3–32 chars: letters, digits, . _ -'),
    body('password').isLength({ min: 6 }).withMessage('password must be at least 6 characters'),
  ],
  validate,
  async (req, res) => {
    const domain = config.signup.domain;
    const username = String(req.body.username).trim().toLowerCase();
    const email = req.body.email;
    const password = req.body.password;

    try {
      // Duplicate check (authoritative, against the PBX DB).
      if (await fusionpbxService.extensionExists(username, domain)) {
        return res.status(409).json({ error: `The username "${username}" is already taken.` });
      }

      const issued = otpService.issue(email, { username, password, domain, email });
      if (issued.cooldown) {
        return res.status(429).json({
          error: 'A code was just sent. Please wait before requesting another.',
          retry_after_ms: issued.retryAfterMs,
        });
      }

      const mail = await mailService.sendOtp(email, issued.code);
      logger.info('Signup started', { email, username, emailed: mail.sent });

      // In non-production with SMTP unconfigured, surface the code for testing.
      const body = { pending: true, message: 'Verification code sent to your email.' };
      if (mail.devCode) body.dev_code = mail.devCode;
      return res.json(body);
    } catch (err) {
      logger.error('register/start failed', { error: err.message });
      return res.status(500).json({ error: 'Could not start registration.' });
    }
  }
);

/**
 * POST /api/auth/register/verify
 * Checks the OTP and, on success, provisions the extension and returns creds.
 */
router.post(
  '/register/verify',
  signupLimiter,
  [
    body('email').isEmail().withMessage('valid email is required').normalizeEmail(),
    body('code').isLength({ min: 4, max: 8 }).withMessage('code is required'),
  ],
  validate,
  async (req, res) => {
    try {
      const result = otpService.verify(req.body.email, req.body.code);
      if (!result.ok) {
        const map = {
          not_found: [404, 'No pending signup for this email. Start again.'],
          expired: [410, 'Your code has expired. Please request a new one.'],
          too_many_attempts: [429, 'Too many incorrect attempts. Request a new code.'],
          mismatch: [401, 'Incorrect code.' + (result.remaining != null ? ` ${result.remaining} attempts left.` : '')],
        };
        const [status, message] = map[result.reason] || [400, 'Verification failed.'];
        return res.status(status).json({ error: message });
      }

      const { username, password, domain, email } = result.payload;

      // Re-check duplicate right before creating (race safety).
      if (await fusionpbxService.extensionExists(username, domain)) {
        return res.status(409).json({ error: `The username "${username}" is already taken.` });
      }

      const created = await fusionpbxService.createExtension({
        extension: username,
        password,
        domain,
        displayName: username,
        email,
      });

      logger.info('Extension provisioned', { username, domain });
      return res.json(buildAccountResponse(created.extension, created.password));
    } catch (err) {
      logger.error('register/verify failed', { error: err.message });
      return res.status(503).json({
        error: 'Account verified, but provisioning failed. Please contact support.',
        detail: config.server.env !== 'production' ? err.message : undefined,
      });
    }
  }
);

/**
 * POST /api/auth/signin
 * Username/password sign-in for an existing extension; returns SIP credentials.
 */
router.post(
  '/signin',
  signupLimiter,
  [
    body('username').notEmpty().withMessage('username is required'),
    body('password').notEmpty().withMessage('password is required'),
  ],
  validate,
  async (req, res) => {
    const domain = req.body.domain || config.signup.domain;
    const username = String(req.body.username).trim().toLowerCase();
    const password = req.body.password;

    try {
      const result = await fusionpbxService.signin({ username, password, domain });
      if (!result.ok) {
        // Deliberately generic for not_found / bad_password to avoid user enumeration.
        return res.status(401).json({ error: 'Incorrect username or password.' });
      }
      logger.info('Signin ok', { username, domain });
      return res.json(buildAccountResponse(result.extension, result.sipPassword, result.displayName));
    } catch (err) {
      logger.error('signin failed', { error: err.message });
      return res.status(500).json({ error: 'Sign-in failed. Please try again.' });
    }
  }
);

// ─── Google Sign-In ────────────────────────────────────────────────────────────
//
// The app authenticates the user with Google (OAuth implicit / id_token flow) and
// posts the ID token here. We verify it (audience must be one of our client IDs),
// then get-or-create the matching FusionPBX extension and return SIP credentials.
//
//   POST /api/auth/google/signup   { id_token }  → create if new, else return
//   POST /api/auth/google/signin   { id_token }  → return existing (auto-create if
//                                                   GOOGLE_AUTOPROVISION != false)

async function handleGoogle(req, res, { allowCreate }) {
  const idToken = req.body.id_token || req.body.idToken;
  const domain = config.signup.domain;

  const verified = await googleAuthService.verifyIdToken(idToken);
  if (!verified.ok) {
    const map = {
      missing_token:     [400, 'Missing Google token.'],
      not_configured:    [503, 'Google sign-in is not configured on the server.'],
      invalid_token:     [401, 'Invalid Google token.'],
      audience_mismatch: [401, 'Google token was issued for a different app.'],
      bad_issuer:        [401, 'Google token has an unexpected issuer.'],
      expired:           [401, 'Google token has expired. Please sign in again.'],
      email_unverified:  [403, 'Your Google email is not verified.'],
      verify_unavailable:[503, 'Could not verify Google token right now. Try again.'],
    };
    const [status, message] = map[verified.reason] || [401, 'Google sign-in failed.'];
    return res.status(status).json({ error: message });
  }

  const { sub, email, name } = verified.claims;
  const baseUsername = googleAuthService.deriveUsername(email, sub);

  try {
    const result = await fusionpbxService.provisionGoogle({
      sub, email, name, domain, baseUsername,
      allowCreate: allowCreate || config.google.autoProvisionOnSignin,
    });

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return res.status(404).json({ error: 'No account for this Google user yet. Sign up first.' });
      }
      if (result.reason === 'disabled') {
        return res.status(403).json({ error: 'This account is disabled. Contact support.' });
      }
      return res.status(400).json({ error: 'Could not provision Google account.' });
    }

    logger.info('Google auth ok', { email, extension: result.extension, created: !!result.created });
    return res.json(buildAccountResponse(result.extension, result.sipPassword, result.displayName));
  } catch (err) {
    logger.error('Google provisioning failed', { error: err.message });
    return res.status(503).json({
      error: 'Signed in with Google, but provisioning failed. Please try again.',
      detail: config.server.env !== 'production' ? err.message : undefined,
    });
  }
}

/**
 * GET /api/auth/google/callback
 *
 * Registered as the Web OAuth client's redirect URI. Google returns the id_token
 * in the URL *fragment* (#id_token=...), which never reaches the server — so we
 * serve a tiny HTML page that reads the fragment client-side and bounces it to the
 * app's custom scheme (carried in `state`). WebAuthenticator then completes.
 */
router.get('/google/callback', (req, res) => {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signing you in…</title></head>
<body style="font-family:sans-serif;background:#1A1A1C;color:#eee;text-align:center;padding-top:40px">
<p>Completing Google sign-in…</p>
<script>
(function () {
  try {
    var frag = window.location.hash ? window.location.hash.substring(1) : '';
    var qp = new URLSearchParams(window.location.search);
    var params = new URLSearchParams(frag);
    // state carries the app's custom-scheme redirect target.
    var state = params.get('state') || qp.get('state') || '';
    var appRedirect = state ? decodeURIComponent(state) : 'com.pvtcall.app:/oauth2redirect';
    var idToken = params.get('id_token');
    var error = params.get('error') || qp.get('error');
    var out = idToken
      ? (appRedirect + '#id_token=' + encodeURIComponent(idToken))
      : (appRedirect + '#error=' + encodeURIComponent(error || 'no_id_token'));
    window.location.replace(out);
  } catch (e) {
    document.body.innerHTML = '<p>Sign-in failed. You can close this window.</p>';
  }
})();
</script>
</body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

router.post('/google/signup', signupLimiter,
  [body('id_token').optional(), body('idToken').optional()],
  validate,
  (req, res) => handleGoogle(req, res, { allowCreate: true }));

router.post('/google/signin', signupLimiter,
  [body('id_token').optional(), body('idToken').optional()],
  validate,
  (req, res) => handleGoogle(req, res, { allowCreate: false }));

module.exports = router;
