/**
 * OTP Service
 *
 * In-memory one-time-password store for email-verified signup.
 * Codes are hashed (never stored in plaintext), expire after a TTL, and are
 * limited to a small number of verification attempts to resist brute force.
 *
 * NOTE: This store is per-process. For multi-instance deployments, back it with
 * Redis or a DB table instead. For a single API daemon on the PBX host it's fine.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

const TTL_MS = 10 * 60 * 1000;   // codes valid for 10 minutes
const MAX_ATTEMPTS = 5;          // verification attempts per code
const RESEND_COOLDOWN_MS = 60 * 1000; // min gap between (re)sends per key

// key (normalized email) -> { hash, expiresAt, attempts, lastSentAt, payload }
const store = new Map();

function hash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function normalizeKey(email) {
  return String(email || '').trim().toLowerCase();
}

function generateCode() {
  // 6-digit numeric code, zero-padded.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Create (or refresh) an OTP for a key and attach the pending signup payload.
 * Returns { code, cooldown } — `cooldown` true means a resend was blocked.
 */
function issue(email, payload) {
  const key = normalizeKey(email);
  const now = Date.now();
  const existing = store.get(key);

  if (existing && now - existing.lastSentAt < RESEND_COOLDOWN_MS) {
    return { cooldown: true, retryAfterMs: RESEND_COOLDOWN_MS - (now - existing.lastSentAt) };
  }

  const code = generateCode();
  store.set(key, {
    hash: hash(code),
    expiresAt: now + TTL_MS,
    attempts: 0,
    lastSentAt: now,
    payload,
  });
  logger.info('OTP issued', { key });
  return { code, cooldown: false };
}

/**
 * Verify a code for a key.
 * Returns { ok: true, payload } on success, or { ok: false, reason } otherwise.
 * A successful verification consumes (deletes) the OTP.
 */
function verify(email, code) {
  const key = normalizeKey(email);
  const entry = store.get(key);

  if (!entry) return { ok: false, reason: 'not_found' };
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return { ok: false, reason: 'expired' };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    store.delete(key);
    return { ok: false, reason: 'too_many_attempts' };
  }

  entry.attempts += 1;

  const provided = hash(code);
  // Constant-time compare.
  const match =
    provided.length === entry.hash.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(entry.hash));

  if (!match) {
    const remaining = MAX_ATTEMPTS - entry.attempts;
    return { ok: false, reason: 'mismatch', remaining };
  }

  const payload = entry.payload;
  store.delete(key);
  return { ok: true, payload };
}

// Periodic cleanup of expired entries.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

module.exports = { issue, verify, TTL_MS, MAX_ATTEMPTS };
