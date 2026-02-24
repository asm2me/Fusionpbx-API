/**
 * Authentication Middleware
 *
 * Three auth paths:
 *
 *  1. Domain API Key  (X-API-Key header or ?api_key= query)
 *     – Keys are stored in FusionPBX's v_api_keys table (SHA-256 hashed).
 *     – Each key is linked to a FusionPBX user + domain.
 *     – On success: req.domain is locked to that key's domain.
 *     – Results are cached in-memory for config.auth.keyCacheTtl ms.
 *
 *  2. Bootstrap Admin Key  (ADMIN_API_KEY env var, optional)
 *     – Cross-domain access for initial setup before DB keys exist.
 *     – req.user.admin = true; domain comes from ?domain= or body.domain.
 *
 *  3. JWT Bearer  (Authorization: Bearer <token>)
 *     – Issued by POST /api/auth/token; carries domain + user in payload.
 */

const jwt      = require('jsonwebtoken');
const config   = require('../config/config');
const logger   = require('../utils/logger');

// ─── In-memory key cache ──────────────────────────────────────────────────────
// Map<rawKey, { data: keyRecord, cachedAt: timestamp }>
// Keeps hot keys out of the DB on every request.
const _keyCache = new Map();

function _getCached(rawKey) {
  const entry = _keyCache.get(rawKey);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > config.auth.keyCacheTtl) {
    _keyCache.delete(rawKey);
    return null;
  }
  return entry.data;
}

function _setCache(rawKey, data) {
  _keyCache.set(rawKey, { data, cachedAt: Date.now() });
}

/**
 * Invalidate a specific key in the cache.
 * Call this immediately after revoking or disabling a key.
 */
function invalidateKeyCache(rawKey) {
  if (rawKey) _keyCache.delete(rawKey);
}

/**
 * Clear the entire cache (e.g. after bulk operations).
 */
function clearKeyCache() {
  _keyCache.clear();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _resolveRequestDomain(req) {
  return req.query.domain || req.body?.domain || req.params?.domain || null;
}

async function _lookupDbKey(rawKey) {
  // Check cache first
  const cached = _getCached(rawKey);
  if (cached !== null) return cached;

  // DB lookup (lazy-require to avoid circular deps at module load time)
  const dbService = require('../services/dbService');
  try {
    const keyData = await dbService.lookupApiKey(rawKey);
    // Cache the result (including null = invalid key, to prevent DB hammering)
    _setCache(rawKey, keyData || false);

    if (keyData) {
      // Fire-and-forget: update last_used_at
      dbService.updateApiKeyLastUsed(keyData.api_key_uuid).catch(() => {});
    }
    return keyData || null;
  } catch (err) {
    logger.error('API key DB lookup error', { error: err.message });
    return null;   // fail open? No — fail closed (return null = reject)
  }
}

// ─── Main middleware ──────────────────────────────────────────────────────────

/**
 * async authenticate middleware.
 * Sets req.user and req.domain on success, calls next().
 * Returns 401 JSON on failure.
 */
async function authenticate(req, res, next) {
  try {
    // ── 1. API Key ────────────────────────────────────────────────────────────
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (apiKey) {
      // Bootstrap admin key from env (bypasses DB entirely)
      if (config.auth.adminApiKey && apiKey === config.auth.adminApiKey) {
        req.user   = { type: 'api_key', userId: 'admin', admin: true };
        req.domain = _resolveRequestDomain(req);
        return next();
      }

      // DB-backed per-user key
      const keyData = await _lookupDbKey(apiKey);
      if (keyData) {
        req.user = {
          type:    'api_key',
          userId:  keyData.username,
          userUuid: keyData.user_uuid,
          domain:  keyData.domain_name,
          admin:   keyData.is_admin,
        };
        // Admin DB keys can still filter by domain; regular keys are locked
        req.domain = keyData.is_admin
          ? (_resolveRequestDomain(req) || keyData.domain_name)
          : keyData.domain_name;
        return next();
      }

      logger.warn('API key rejected', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // ── 2. JWT Bearer ─────────────────────────────────────────────────────────
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const decoded = jwt.verify(token, config.auth.jwtSecret);
        req.user   = { type: 'jwt', ...decoded };
        req.domain = decoded.domain || _resolveRequestDomain(req);
        return next();
      } catch (err) {
        logger.warn('JWT verification failed', { error: err.message });
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }

    return res.status(401).json({
      error: 'Authentication required',
      hint:  'Provide X-API-Key header or Authorization: Bearer <token>',
    });
  } catch (err) {
    logger.error('Auth middleware error', { error: err.message });
    return res.status(500).json({ error: 'Authentication error' });
  }
}

// ─── Token generation ─────────────────────────────────────────────────────────

function generateToken(payload) {
  return jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn,
  });
}

// ─── Domain guard ─────────────────────────────────────────────────────────────

function requireDomain(req, res, next) {
  if (!req.domain) {
    return res.status(400).json({
      error: 'Domain context is required',
      hint:  req.user?.admin
        ? 'Pass ?domain=<domain> or include domain in the request body'
        : 'Your API key has no domain association',
    });
  }
  next();
}

module.exports = {
  authenticate,
  generateToken,
  requireDomain,
  invalidateKeyCache,
  clearKeyCache,
};
