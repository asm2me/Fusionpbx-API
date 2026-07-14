/**
 * Google Sign-In verification + username derivation.
 *
 * Verifies a Google ID token WITHOUT adding a new dependency by delegating the
 * cryptographic check to Google's tokeninfo endpoint, then enforcing the
 * audience (our OAuth client ID) and issuer ourselves.
 */

const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Verify a Google ID token and return its trusted claims.
 * @param {string} idToken
 * @returns {Promise<{ ok: boolean, reason?: string, claims?: object }>}
 */
async function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return { ok: false, reason: 'missing_token' };
  }
  if (!config.google.clientIds.length) {
    logger.error('Google sign-in attempted but GOOGLE_CLIENT_IDS is not configured');
    return { ok: false, reason: 'not_configured' };
  }

  let data;
  try {
    const resp = await axios.get(TOKENINFO_URL, {
      params: { id_token: idToken },
      timeout: 8000,
      validateStatus: (s) => s === 200 || s === 400,
    });
    if (resp.status === 400) {
      return { ok: false, reason: 'invalid_token' };
    }
    data = resp.data;
  } catch (err) {
    logger.error('Google tokeninfo request failed', { error: err.message });
    return { ok: false, reason: 'verify_unavailable' };
  }

  // Audience must be one of our client IDs.
  if (!config.google.clientIds.includes(data.aud)) {
    logger.warn('Google token audience mismatch', { aud: data.aud });
    return { ok: false, reason: 'audience_mismatch' };
  }

  // Issuer must be Google.
  if (!VALID_ISSUERS.includes(data.iss)) {
    return { ok: false, reason: 'bad_issuer' };
  }

  // Expiry (tokeninfo returns `exp` as unix seconds string).
  const exp = parseInt(data.exp, 10);
  if (!exp || exp * 1000 < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  // Require a verified email — it's the identity we provision against.
  if (!data.email || String(data.email_verified) !== 'true') {
    return { ok: false, reason: 'email_unverified' };
  }

  return {
    ok: true,
    claims: {
      sub: data.sub,
      email: String(data.email).toLowerCase(),
      emailVerified: true,
      name: data.name || data.given_name || null,
      picture: data.picture || null,
    },
  };
}

/**
 * Derive a stable, FusionPBX-safe extension/username from a Google email.
 * Uses the local-part, sanitized; falls back to a short hash of the subject to
 * keep it unique and within the [a-z0-9._-]{3,32} rule.
 */
function deriveUsername(email, sub) {
  const local = String(email || '').split('@')[0].toLowerCase();
  let base = local.replace(/[^a-z0-9._-]/g, '');
  if (base.length < 3) {
    base = `g${(sub || '').replace(/[^0-9]/g, '').slice(0, 8)}`;
  }
  return base.slice(0, 32);
}

module.exports = { verifyIdToken, deriveUsername };
