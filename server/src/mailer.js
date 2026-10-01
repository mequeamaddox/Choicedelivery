// Sends mail through Resend (https://resend.com) when RESEND_API_KEY is set; otherwise logs.
// Every attempt is recorded in email_log (shown on the owner's Account page) with Resend's error if it failed.
let override = null;
const setSender = (fn) => { override = fn; }; // for tests

async function record(to, subject, status, error) {
  try {
    const db = require('./db'); // required lazily: the mailer is loaded before the database in some scripts
    await db.query('INSERT INTO email_log (recipient, subject, status, error) VALUES ($1, $2, $3, $4)',
      [String(Array.isArray(to) ? to.join(', ') : to).slice(0, 300), String(subject).slice(0, 300), status, error ? String(error).slice(0, 1000) : null]);
    if (Math.random() < 0.05) await db.query('DELETE FROM email_log WHERE id < (SELECT max(id) - 500 FROM email_log)');
  } catch { /* the log is best-effort */ }
}

async function deliver({ to, subject, html }) {
  if (override) return override({ to, subject, html });
  if (!process.env.RESEND_API_KEY) {
    console.log(`[mail disabled] To: ${to} | ${subject}\n${html}`);
    return 'not_configured';
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Choice Delivery <onboarding@resend.dev>',
      // Where replies go (the From address is send-only), e.g. info@choicedeliverysc.com.
      ...(process.env.MAIL_REPLY_TO ? { reply_to: process.env.MAIL_REPLY_TO } : {}),
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    let reason = body;
    try { reason = JSON.parse(body).message || body; } catch { /* not JSON */ }
    throw new Error(`Email send failed: ${res.status} ${reason}`);
  }
  return 'sent';
}

async function sendMail(message) {
  try {
    const status = await deliver(message);
    await record(message.to, message.subject, status === 'not_configured' ? 'not_configured' : 'sent');
    return status;
  } catch (e) {
    console.error(`Email to ${message.to} failed: ${e.message}`);
    await record(message.to, message.subject, 'failed', e.message.replace(/^Email send failed: /, ''));
    throw e;
  }
}

module.exports = { sendMail, setSender };
