// Emails to drivers (and to dispatch about new applications), sent through Resend like the shipper
// order emails. Without RESEND_API_KEY they're written to the server log instead. Never blocks a request.
const { sendMail } = require('./mailer');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = () => process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
const appPage = () => `${base()}/#/driver-app`;
const firstName = (u) => esc((u.name || '').split(' ')[0] || 'there');

function layout({ greeting, paragraphs, button, footer }) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
  <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><strong>Choice Delivery SC</strong> · Drivers</div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 10px 10px">
    <p>${greeting}</p>
    ${paragraphs.map((p) => `<p>${p}</p>`).join('\n    ')}
    ${button ? `<p><a href="${button.href}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${button.text}</a></p>` : ''}
    <p style="color:#6b7280;font-size:12px">${footer || 'Questions? Call dispatch at (803) 949-7034.'}</p>
  </div></div>`;
}

const send = (to, subject, html) => sendMail({ to, subject, html })
  .catch((e) => console.error(`Driver email "${subject}" failed:`, e.message));

module.exports = {
  applicationReceived: (u) => send(u.email, 'We got your Choice Delivery driver application', layout({
    greeting: `Hi ${firstName(u)},`,
    paragraphs: [
      "Thanks for applying to drive with Choice Delivery. We'll review your application and email you when you're approved, usually within 1–2 business days.",
      'To speed it up, install the driver app, sign in with the email and password you just chose, and finish your profile: profile photo, vehicle, driver\'s license and insurance.',
    ],
    button: { href: appPage(), text: 'Get the driver app' },
  })),

  newApplication: (u) => send(process.env.LEADS_EMAIL || 'info@choicedeliverysc.com', `New driver application: ${u.name || u.email}`, layout({
    greeting: 'New driver application',
    paragraphs: [
      `<strong>${esc(u.name)}</strong> · ${esc(u.email)} · ${esc(u.phone_number)}`,
      `${esc([u.vehicle_color, u.vehicle_year, u.vehicle_make, u.vehicle_model].filter(Boolean).join(' '))}${u.vehicle_type ? ` (${esc(u.vehicle_type)})` : ''}${u.driver_profile?.city ? ` · ${esc(u.driver_profile.city)}` : ''}`,
    ],
    button: { href: `${base()}/#/people/${u.id}`, text: 'Review application' },
    footer: 'Approve or reject it on the People page.',
  })),

  approved: (u) => send(u.email, "You're approved to drive with Choice Delivery", layout({
    greeting: `Welcome aboard, ${firstName(u)}!`,
    paragraphs: [
      'Your driver account is approved. Open the driver app, go online, and you\'ll get alerts for new jobs near you.',
      'Keep your license and insurance up to date in the app; expired documents pause your account until you upload new ones.',
    ],
    button: { href: appPage(), text: 'Open the driver app' },
  })),

  rejected: (u, note) => send(u.email, 'Your Choice Delivery driver application', layout({
    greeting: `Hi ${firstName(u)},`,
    paragraphs: [
      "Thanks for your interest in driving with Choice Delivery. We're not able to approve your application right now.",
      ...(note ? [`<em>${esc(note)}</em>`] : []),
    ],
  })),

  suspended: (u, note) => send(u.email, 'Your Choice Delivery driver account is on hold', layout({
    greeting: `Hi ${firstName(u)},`,
    paragraphs: [
      "Your driver account is on hold, so you won't get new jobs for now.",
      ...(note ? [`<em>${esc(note)}</em>`] : []),
    ],
  })),

  invite: (u, token) => send(u.email, "You're invited to drive with Choice Delivery", layout({
    greeting: `Hi ${firstName(u)},`,
    paragraphs: [
      'Choice Delivery set up a driver account for you. Choose your password first (this link works for 7 days), then install the driver app and sign in with your email.',
    ],
    button: { href: `${base()}/#/reset/${token}`, text: 'Choose your password' },
    footer: `Then get the app: <a href="${appPage()}">${appPage()}</a> · Questions? Call (803) 949-7034.`,
  })),
};
