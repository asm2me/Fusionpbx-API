/**
 * Mail Service
 *
 * Sends transactional email (currently: signup OTP codes) via SMTP using
 * nodemailer. SMTP settings come from .env (see .env.example). If SMTP is not
 * configured, emails are logged instead of sent so the flow is still testable.
 */

const nodemailer = require('nodemailer');
const config = require('../config/config');
const logger = require('../utils/logger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { host, port, user, pass, secure } = config.smtp;
  if (!host) return null; // not configured

  transporter = nodemailer.createTransport({
    host,
    port,
    secure, // true for 465, false for 587/25 (STARTTLS)
    auth: user ? { user, pass } : undefined,
  });
  return transporter;
}

/**
 * Send a signup verification code. Falls back to logging when SMTP is unset
 * (and, in non-production, returns the code so it can be surfaced for testing).
 */
async function sendOtp(email, code) {
  const t = getTransporter();

  if (!t) {
    logger.warn('SMTP not configured — OTP not emailed', { email, code });
    return { sent: false, devCode: config.server.env !== 'production' ? code : undefined };
  }

  await t.sendMail({
    from: config.smtp.from,
    to: email,
    subject: 'Your Private Call verification code',
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your Private Call verification code is:</p>
           <p style="font-size:24px;font-weight:bold;letter-spacing:3px">${code}</p>
           <p>It expires in 10 minutes. If you didn't request this, ignore this email.</p>`,
  });

  logger.info('OTP email sent', { email });
  return { sent: true };
}

module.exports = { sendOtp };
