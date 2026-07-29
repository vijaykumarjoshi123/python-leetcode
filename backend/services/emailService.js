/**
 * Email service — minimal nodemailer wrapper. Spec section 9B.
 *
 * Single exported function: sendInviteEmail(to, assessmentTitle, inviteUrl).
 *
 * Behaviour:
 *   - Reads SMTP_HOST/PORT/USER/PASS/FROM from process.env on every call.
 *   - If SMTP_HOST is unset, logs a warning and returns a stub result
 *     ({messageId: null, skipped: true}). The invite modal on the
 *     frontend still generates copy-pasteable URLs in that case, so
 *     development is unblocked without real SMTP credentials.
 *   - Builds both plain text and HTML bodies so the recipient sees a
 *     readable fallback if their client doesn't render HTML.
 *   - Never throws on SMTP failure — logs and returns {error} instead.
 *     Routes that send invites should treat the result as best-effort.
 */

const nodemailer = require('nodemailer');

const FROM = process.env.SMTP_FROM || 'noreply@yourplatform.com';

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  _transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return _transporter;
}

function buildPlainText({ assessmentTitle, inviteUrl }) {
  return [
    'You have been invited to a data engineering assessment.',
    '',
    `Assessment: ${assessmentTitle}`,
    '',
    `Open the assessment by clicking the link below (single-use, expires with the assessment):`,
    inviteUrl,
    '',
    'If you were not expecting this email you can safely ignore it.',
  ].join('\n');
}

function buildHtml({ assessmentTitle, inviteUrl }) {
  // Deliberately plain HTML — no external assets, no images. Most clients
  // (including text-mode readers) render this OK.
  const safeTitle = escapeHtml(assessmentTitle);
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, sans-serif; line-height: 1.5; color: #222; max-width: 560px; margin: 0 auto; padding: 24px;">
    <h2 style="margin-top: 0; color: #333;">You're invited to an assessment</h2>
    <p>You have been invited to a data engineering assessment:</p>
    <p style="padding: 12px 16px; background: #f5f7fa; border-radius: 6px;"><strong>${safeTitle}</strong></p>
    <p>Click the button below to open it. This link is single-use.</p>
    <p style="margin: 24px 0;">
      <a href="${inviteUrl}" style="display: inline-block; padding: 10px 20px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">Open assessment</a>
    </p>
    <p style="font-size: 0.85rem; color: #888;">Or copy this URL:<br /><code style="word-break: break-all;">${inviteUrl}</code></p>
    <p style="font-size: 0.8rem; color: #aaa; margin-top: 32px;">If you weren't expecting this email you can safely ignore it.</p>
  </body>
</html>`;
}

// Escape HTML special chars. Using String.fromCharCode for the apostrophe
// so we don't have to write it as a string literal in this file (a JS
// string with an apostrophe inside a template literal causes parse
// errors when the template is opened in certain contexts).
const APOSTROPHE = String.fromCharCode(39);
const HTML_ESCAPES = {
  '&': '&',
  '<': '<',
  '>': '>',
  '"': '"',
  [APOSTROPHE]: APOSTROPHE,
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Send an invite email to a candidate.
 *
 * @param {string} to — recipient email address
 * @param {string} assessmentTitle — used in the subject + body
 * @param {string} inviteUrl — full URL the candidate clicks
 * @returns {Promise<{messageId: string|null, skipped?: boolean, error?: string}>}
 *
 * Never throws. On missing SMTP config returns {skipped: true}. On
 * transport failure returns {error}.
 */
async function sendInviteEmail(to, assessmentTitle, inviteUrl) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(
      `[emailService] SMTP_HOST is not configured; skipping invite send to ${to}. ` +
      `Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM to enable real sends.`
    );
    return { messageId: null, skipped: true };
  }

  const subject = `You're invited: ${assessmentTitle}`;
  try {
    const info = await transporter.sendMail({
      from: FROM,
      to,
      subject,
      text: buildPlainText({ assessmentTitle, inviteUrl }),
      html: buildHtml({ assessmentTitle, inviteUrl }),
    });
    return { messageId: info.messageId || null };
  } catch (err) {
    console.error(`[emailService] failed to send invite to ${to}:`, err.message);
    return { messageId: null, error: err.message };
  }
}

module.exports = {
  sendInviteEmail,
};
