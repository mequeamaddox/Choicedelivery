// Sends mail through Resend (https://resend.com) when RESEND_API_KEY is set; otherwise logs.
let override = null;
const setSender = (fn) => { override = fn; }; // for tests

async function sendMail({ to, subject, html }) {
  if (override) return override({ to, subject, html });
  if (!process.env.RESEND_API_KEY) {
    console.log(`[mail disabled] To: ${to} | ${subject}\n${html}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Choice Delivery <onboarding@resend.dev>',
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
}

module.exports = { sendMail, setSender };
