// Applying for Net terms: a customer paying by card asks to be billed on account. Dispatch approves (with
// terms and an optional credit limit), which switches the company to monthly invoices, or declines.
const db = require('./db');
const { sendMail } = require('./mailer');
const { HttpError, str } = require('./util');

const TERMS = [0, 15, 30, 45, 60];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const staffInbox = () => process.env.ORDER_ALERTS_EMAIL || process.env.LEADS_EMAIL || 'info@choicedeliverysc.com';
const support = () => process.env.SUPPORT_EMAIL || 'info@choicedeliverysc.com';
const base = () => process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
const termsLabel = (d) => (Number(d) === 0 ? 'Due on receipt' : `Net ${d}`);

// The fields of an application, cleaned; throws on what's missing.
function cleanApplication(b = {}) {
  const t = (k, n = 200) => str(b[k]).slice(0, n);
  const refs = (Array.isArray(b.references) ? b.references : []).slice(0, 3)
    .map((r) => ({ company: str(r?.company).slice(0, 120), contact: str(r?.contact).slice(0, 120), phone: str(r?.phone).slice(0, 40), email: str(r?.email).slice(0, 120) }))
    .filter((r) => r.company);
  const data = {
    legalName: t('legalName', 160), dba: t('dba', 160), ein: t('ein', 20), address: t('address', 300),
    yearsInBusiness: t('yearsInBusiness', 20), apName: t('apName', 120), apEmail: t('apEmail', 160).toLowerCase(), apPhone: t('apPhone', 40),
    monthlyDeliveries: t('monthlyDeliveries', 40), requestedTerms: Number(b.requestedTerms), poRequired: b.poRequired === true,
    references: refs, notes: t('notes', 1000), agreed: b.agreed === true,
  };
  if (!data.legalName) throw new HttpError(400, "Enter the business's legal name");
  if (!data.address) throw new HttpError(400, 'Enter the business address');
  if (!data.apName || !emailOk(data.apEmail)) throw new HttpError(400, 'Enter the accounts payable contact and their email (where invoices go)');
  if (!TERMS.includes(data.requestedTerms) || data.requestedTerms === 0) data.requestedTerms = 30;
  if (!data.agreed) throw new HttpError(400, 'Please agree to pay invoices by their due date');
  return data;
}

const serialize = (a) => a && ({
  id: a.id, organizationId: a.organization_id, company: a.company, status: a.status, data: a.data,
  submittedAt: a.submitted_at, submittedBy: a.submitted_by_name || a.submitted_by_email || null, submittedByEmail: a.submitted_by_email || null,
  reviewedAt: a.reviewed_at, approvedTerms: a.approved_terms, terms: a.approved_terms != null ? termsLabel(a.approved_terms) : null,
  creditLimitCents: a.credit_limit_cents, decisionNote: a.decision_note,
});

const SELECT = `SELECT a.*, o.name AS company, u.name AS submitted_by_name, u.email AS submitted_by_email
  FROM credit_applications a JOIN organizations o ON o.id = a.organization_id LEFT JOIN users u ON u.id = a.submitted_by`;

async function latestFor(orgId) {
  const { rows: [a] } = await db.query(`${SELECT} WHERE a.organization_id = $1 ORDER BY a.submitted_at DESC LIMIT 1`, [orgId]);
  return serialize(a);
}

async function list(status) {
  const { rows } = await db.query(`${SELECT} WHERE ($1::text IS NULL OR a.status = $1) ORDER BY a.submitted_at DESC LIMIT 100`, [status || null]);
  return rows.map(serialize);
}

async function submit(orgId, user, body) {
  const data = cleanApplication(body);
  const { rows: [org] } = await db.query('SELECT name, billing_mode FROM organizations WHERE id = $1', [orgId]);
  if (!org) throw new HttpError(404, 'Company not found');
  if (org.billing_mode === 'invoice') throw new HttpError(409, 'Your company is already billed on account');
  let id;
  try {
    ({ rows: [{ id }] } = await db.query(
      'INSERT INTO credit_applications (organization_id, data, submitted_by) VALUES ($1, $2, $3) RETURNING id', [orgId, JSON.stringify(data), user.id]));
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, "Your application is already in; we'll email you once it's reviewed");
    throw e;
  }
  const app = (await list()).find((a) => a.id === id);
  const row = (k, v) => (v ? `<tr><td style="color:#6b7280;padding:3px 14px 3px 0;vertical-align:top">${k}</td><td>${v}</td></tr>` : '');
  sendMail({
    to: staffInbox(),
    subject: `Net terms application: ${org.name} (${termsLabel(data.requestedTerms)})`,
    html: `<p><strong>${esc(org.name)}</strong> applied to be billed on account.</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${row('Legal name', esc(data.legalName))}${row('DBA', esc(data.dba))}${row('EIN', esc(data.ein))}${row('Address', esc(data.address))}
        ${row('In business', esc(data.yearsInBusiness))}${row('Deliveries / month', esc(data.monthlyDeliveries))}
        ${row('Accounts payable', `${esc(data.apName)} · ${esc(data.apEmail)}${data.apPhone ? ` · ${esc(data.apPhone)}` : ''}`)}
        ${row('Requested terms', termsLabel(data.requestedTerms))}${row('PO numbers', data.poRequired ? 'Required on invoices' : 'Not required')}
        ${row('References', data.references.map((r) => esc([r.company, r.contact, r.phone, r.email].filter(Boolean).join(' · '))).join('<br>'))}
        ${row('Notes', esc(data.notes))}${row('Submitted by', esc(app?.submittedBy || ''))}
      </table>
      <p><a href="${base()}/#/invoices">Review it on the Invoices page</a></p>`,
  }).catch((e) => console.error('Credit application alert failed:', e.message));
  const { rows: [u] } = await db.query('SELECT name, email FROM users WHERE id = $1', [user.id]);
  sendMail({
    to: u.email, replyTo: support(),
    subject: `We got your application for monthly invoicing, ${org.name}`,
    html: `<p>Hi ${esc((u.name || '').split(' ')[0] || 'there')},</p>
      <p>Thanks for applying to be billed on account. We'll review it and email you, usually within 1–2 business days.
      Until then, you can keep booking and paying by card as usual.</p><p>The Choice Delivery team</p>`,
  }).catch((e) => console.error('Credit application receipt failed:', e.message));
  return app;
}

async function decide(appId, reviewer, { approve, termsDays, creditLimitCents, note }) {
  const result = await db.withTx(async (client) => {
    const { rows: [a] } = await client.query("SELECT * FROM credit_applications WHERE id = $1 AND status = 'pending' FOR UPDATE", [appId]);
    if (!a) throw new HttpError(409, 'This application was already reviewed');
    const terms = approve ? (TERMS.includes(Number(termsDays)) ? Number(termsDays) : a.data.requestedTerms || 30) : null;
    const limit = approve && Number(creditLimitCents) > 0 ? Math.round(Number(creditLimitCents)) : null;
    await client.query(
      `UPDATE credit_applications SET status = $2, reviewed_by = $3, reviewed_at = now(), approved_terms = $4,
         credit_limit_cents = $5, decision_note = $6 WHERE id = $1`,
      [appId, approve ? 'approved' : 'declined', reviewer.id, terms, limit, str(note).slice(0, 500) || null]);
    if (approve) {
      // Bills go to their accounts payable contact from now on.
      await client.query(
        `UPDATE organizations SET billing_mode = 'invoice', payment_terms_days = $2, credit_limit_cents = $3,
           billing_email = $4, updated_at = now() WHERE id = $1`, [a.organization_id, terms, limit, a.data.apEmail]);
    }
    return { a, terms, limit };
  });
  const { rows: [org] } = await db.query('SELECT name FROM organizations WHERE id = $1', [result.a.organization_id]);
  const { rows: [u] } = await db.query('SELECT name, email FROM users WHERE id = $1', [result.a.submitted_by]);
  const to = [...new Set([u?.email, result.a.data.apEmail].filter(Boolean))];
  const hi = `<p>Hi ${esc((u?.name || '').split(' ')[0] || 'there')},</p>`;
  sendMail({
    to, replyTo: support(),
    subject: approve ? `Approved: ${org.name} is now billed monthly (${termsLabel(result.terms)})` : `About your application for monthly invoicing, ${org.name}`,
    html: approve
      ? `${hi}<p>Good news: <strong>${esc(org.name)}</strong> is approved for monthly invoicing on <strong>${termsLabel(result.terms)}</strong> terms.</p>
        <p>From now on there's nothing to pay when you book. Deliveries are billed to your account, and you'll get one invoice a month
        at ${esc(result.a.data.apEmail)}, listing every delivery${result.a.data.poRequired ? ' with your PO number (enter it in the "PO / job number" box when you book)' : ''}.
        You can pay invoices by check, ACH or card.</p>
        ${result.limit ? `<p>Your account limit is $${(result.limit / 100).toLocaleString('en-US')}. If you need more, just reply to this email.</p>` : ''}
        <p><a href="${base()}/#/orders/new" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Book a delivery</a></p>
        <p>The Choice Delivery team</p>`
      : `${hi}<p>Thanks for applying for monthly invoicing for ${esc(org.name)}. We aren't able to set up an account at this time${note ? `: ${esc(note)}` : ''}.</p>
        <p>You can keep booking and paying by card, and you're welcome to apply again later. Questions? Just reply to this email.</p>
        <p>The Choice Delivery team</p>`,
  }).catch((e) => console.error('Credit decision email failed:', e.message));
  return (await list()).find((x) => x.id === appId);
}

module.exports = { submit, decide, latestFor, list, cleanApplication };
