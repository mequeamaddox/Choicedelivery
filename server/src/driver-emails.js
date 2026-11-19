// Emails to drivers (and to dispatch about new applications), sent through Resend like the shipper
// order emails. Without RESEND_API_KEY they're written to the server log instead. Never blocks a request.
const { sendMail } = require('./mailer');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = () => process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
const appPage = () => `${base()}/#/driver-app`;
const support = () => process.env.SUPPORT_EMAIL || 'info@choicedeliverysc.com';
const firstName = (u) => esc((u.name || '').split(' ')[0] || 'there');

function layout({ greeting, paragraphs, button, footer }) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
  <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><strong>Choice Delivery SC</strong> · Drivers</div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 10px 10px">
    <p>${greeting}</p>
    ${paragraphs.map((p) => `<p>${p}</p>`).join('\n    ')}
    ${button ? `<p><a href="${button.href}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${button.text}</a></p>` : ''}
    <p style="color:#6b7280;font-size:12px">${footer || `Questions? Just reply to this email or write to ${support()}.`}</p>
  </div></div>`;
}

// What a new applicant has to do (the same things the driver checklist asks for).
const APPLICATION_STEPS = [
  'Profile photo, and photos of your driver\'s license and insurance card',
  'Vehicle details (make, model, plate)',
  "Driver's license and insurance details (number, company, expiration dates)",
  'An emergency contact',
  'Direct deposit and tax info (a secure Stripe form)',
  'Sign the driver agreement (about 5 minutes)',
];
const checklistHtml = (items) => `<ul style="padding-left:20px;margin:6px 0">${items.map((i) => `<li style="margin:4px 0">${esc(i)}</li>`).join('')}</ul>`;
const finishUrl = () => `${base()}/#/driver`;

// Replies go to the support inbox, so drivers can answer the email instead of calling.
const send = (to, subject, html) => sendMail({ to, subject, html, replyTo: support() })
  .catch((e) => console.error(`Driver email "${subject}" failed:`, e.message));

module.exports = {
  // Right after applying: everything they need to finish, and one button that works on any phone.
  applicationReceived: (u) => send(u.email, 'Next steps for your Choice Delivery driver application', layout({
    greeting: `Hi ${firstName(u)},`,
    paragraphs: [
      "Thanks for applying to drive with Choice Delivery! We can approve you as soon as your application is complete. Here's what's left (about 15 minutes):",
      checklistHtml(APPLICATION_STEPS),
      'Tap the button below and sign in with the email and password you just chose. Your to-do list shows what\'s done and what\'s left, on iPhone or Android.',
    ],
    button: { href: finishUrl(), text: 'Finish your application' },
    footer: `We'll email you when you're approved, usually within 1–2 business days of finishing. Questions? Just reply to this email or write to ${support()}.`,
  })),

  // A nudge when an applicant hasn't finished: what's still missing (from their checklist).
  applicationReminder: (u, missing) => send(u.email, 'Finish your Choice Delivery driver application', layout({
    greeting: `Hi ${firstName(u)},`,
    paragraphs: [
      "You started an application to drive with Choice Delivery. We can't approve it until it's complete. Still needed:",
      checklistHtml(missing),
      'Tap the button below and sign in with the email and password you chose when you applied. Forgot your password? Tap "Forgot password?" on the sign-in page.',
    ],
    button: { href: finishUrl(), text: 'Finish your application' },
  })),

  newApplication: (u) => send(process.env.LEADS_EMAIL || 'info@choicedeliverysc.com', `New driver application: ${u.name || u.email}`, layout({
    greeting: 'New driver application',
    paragraphs: [
      `<strong>${esc(u.name)}</strong> · ${esc(u.email)} · ${esc(u.phone_number)}`,
      `${esc([u.vehicle_color, u.vehicle_year, u.vehicle_make, u.vehicle_model].filter(Boolean).join(' '))}${u.vehicle_type ? ` (${esc(u.vehicle_type)})` : ''}${u.driver_profile?.city ? ` · ${esc(u.driver_profile.city)}` : ''}`,
    ],
    button: { href: `${base()}/#/people/${u.id}`, text: 'Review application' },
    footer: 'Approve or reject it on the Team page.',
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
    footer: `Then get the app: <a href="${appPage()}">${appPage()}</a> · Questions? Reply to this email.`,
  })),
};

// Every hour: applicants who haven't finished get a reminder 2 days after applying, and one more a week after.
async function remindApplicants() {
  const db = require('./db');
  const { getUser, driverChecklist } = require('./users');
  const { rows } = await db.query(
    `SELECT id FROM users WHERE role = 'driver' AND driver_status = 'applied' AND is_active AND NOT is_demo
       AND ((application_reminders = 0 AND created_at < now() - interval '2 days')
         OR (application_reminders = 1 AND created_at < now() - interval '7 days' AND application_reminded_at < now() - interval '3 days'))`);
  let sent = 0;
  for (const { id } of rows) {
    const u = await getUser(id);
    const { missing } = driverChecklist(u);
    // Counted even when nothing is missing, so a finished applicant isn't checked again.
    await db.query('UPDATE users SET application_reminders = application_reminders + 1, application_reminded_at = now() WHERE id = $1', [id]);
    if (!missing.length) continue;
    await module.exports.applicationReminder(u, missing);
    sent += 1;
  }
  return sent;
}

function startReminderTimer() {
  const tick = () => remindApplicants().catch((e) => console.error('Applicant reminders failed:', e.message));
  setTimeout(tick, 60 * 1000).unref?.();
  setInterval(tick, 60 * 60 * 1000).unref?.();
}

module.exports.remindApplicants = remindApplicants;
module.exports.startReminderTimer = startReminderTimer;
module.exports.APPLICATION_STEPS = APPLICATION_STEPS;
