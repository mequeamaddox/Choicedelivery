// Invoices for companies billed on account ("Net 30"). Every delivered order and every extra charge billed
// to the account goes on exactly one invoice. Dispatch creates them (one click, or for everyone at once on
// the 1st of the month), sends them by email, and marks them paid when a check or ACH arrives; customers can
// also pay online by card through the invoice's link.
const db = require('./db');
const { CHARGE_KINDS } = require('./pricing');
const { sendMail } = require('./mailer');
const { HttpError } = require('./util');

const TIME_ZONE = 'America/New_York';
const TERMS = [0, 15, 30, 45, 60];
const PAID_METHODS = { check: 'Check', ach: 'ACH / bank transfer', card: 'Card', cash: 'Cash', other: 'Other' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => `$${(Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Dates as YYYY-MM-DD in Columbia time.
const localDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date(d));
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const endOfPreviousMonth = (ymd) => { const d = new Date(`${ymd.slice(0, 7)}-01T12:00:00Z`); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const longDate = (v) => new Date(`${ymd(v)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const termsLabel = (days) => (Number(days) === 0 ? 'Due on receipt' : `Net ${days}`);
const shortAddress = (a) => String(a || '').split(',').slice(0, 2).join(',').trim();

// What's billed to a company's account and not on an invoice yet, through a date (Columbia time).
async function unbilledItems(client, orgId, through, { lock = false } = {}) {
  const forUpdate = lock ? 'FOR UPDATE OF o' : '';
  const { rows: orders } = await client.query(
    `SELECT o.id, o.order_number, o.price_cents, o.po_number, o.tracking_number,
            (o.completed_at AT TIME ZONE '${TIME_ZONE}')::date AS day,
            (SELECT address FROM stops WHERE order_id = o.id ORDER BY sequence LIMIT 1) AS first_address,
            (SELECT address FROM stops WHERE order_id = o.id ORDER BY sequence DESC LIMIT 1) AS last_address,
            (SELECT count(*) FROM stops WHERE order_id = o.id)::int AS stop_count
     FROM orders o
     WHERE o.organization_id = $1 AND o.payment_status = 'invoice' AND o.status = 'completed' AND o.invoice_id IS NULL
       AND NOT o.is_demo AND o.price_cents > 0 AND (o.completed_at AT TIME ZONE '${TIME_ZONE}')::date <= $2
     ORDER BY o.completed_at ${forUpdate}`, [orgId, through]);
  const { rows: charges } = await client.query(
    `SELECT c.id, c.order_id, c.kind, c.description, c.cents, c.minutes, o.order_number, o.po_number, o.tracking_number,
            (c.created_at AT TIME ZONE '${TIME_ZONE}')::date AS day
     FROM order_charges c JOIN orders o ON o.id = c.order_id
     WHERE o.organization_id = $1 AND c.status = 'invoice' AND c.invoice_id IS NULL AND NOT o.is_demo
       AND o.status IN ('completed', 'cancelled') AND (c.created_at AT TIME ZONE '${TIME_ZONE}')::date <= $2
     ORDER BY c.created_at ${lock ? 'FOR UPDATE OF c' : ''}`, [orgId, through]);
  const lines = [
    ...orders.map((o) => ({
      orderId: o.id, chargeId: null, day: ymd(o.day), cents: o.price_cents, reference: o.po_number || o.tracking_number || null,
      description: `${o.order_number} · Delivery ${shortAddress(o.first_address)} → ${shortAddress(o.last_address)}${o.stop_count > 2 ? ` (${o.stop_count} stops)` : ''}`,
    })),
    ...charges.map((c) => ({
      orderId: c.order_id, chargeId: c.id, day: ymd(c.day), cents: c.cents, reference: c.po_number || c.tracking_number || null,
      description: `${c.order_number} · ${CHARGE_KINDS[c.kind] || 'Additional charge'}${c.minutes ? ` (${c.minutes} min)` : ''}${c.description ? `: ${c.description}` : ''}`,
    })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.description.localeCompare(b.description));
  return { orders, charges, lines, totalCents: lines.reduce((t, l) => t + l.cents, 0) };
}

// Puts everything unbilled through `through` on a new invoice. Returns its id, or null if there was nothing to bill.
async function createInvoice(client, orgId, { through = localDate(), actorId = null } = {}) {
  const { rows: [org] } = await client.query('SELECT id, payment_terms_days FROM organizations WHERE id = $1 FOR UPDATE', [orgId]);
  if (!org) throw new HttpError(404, 'Company not found');
  const items = await unbilledItems(client, orgId, through, { lock: true });
  if (!items.lines.length) return null;
  const { rows: [{ n }] } = await client.query("SELECT nextval('invoice_number_seq') AS n");
  const issued = localDate();
  const { rows: [inv] } = await client.query(
    `INSERT INTO invoices (organization_id, invoice_number, period_start, period_end, terms_days, due_date, total_cents, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [orgId, `INV-${n}`, items.lines[0].day, through, org.payment_terms_days, addDays(issued, org.payment_terms_days), items.totalCents, actorId]);
  for (const [i, l] of items.lines.entries()) {
    await client.query(
      `INSERT INTO invoice_lines (invoice_id, order_id, charge_id, day, description, reference, cents, sequence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [inv.id, l.orderId, l.chargeId, l.day, l.description, l.reference, l.cents, i + 1]);
  }
  await client.query('UPDATE orders SET invoice_id = $2 WHERE id = ANY($1::uuid[])', [items.orders.map((o) => o.id), inv.id]);
  await client.query('UPDATE order_charges SET invoice_id = $2 WHERE id = ANY($1::uuid[])', [items.charges.map((c) => c.id), inv.id]);
  return inv.id;
}

async function getInvoice(where, value) {
  const { rows: [inv] } = await db.query(
    `SELECT i.*, o.name AS company, o.billing_email, o.phone AS company_phone, o.address AS company_address
     FROM invoices i JOIN organizations o ON o.id = i.organization_id WHERE i.${where} = $1`, [value]).catch(() => ({ rows: [] }));
  if (!inv) return null;
  const { rows: lines } = await db.query('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY sequence', [inv.id]);
  return serialize(inv, lines);
}

function serialize(i, lines) {
  const today = localDate();
  return {
    id: i.id, invoiceNumber: i.invoice_number, organizationId: i.organization_id, company: i.company,
    billingEmail: i.billing_email || null, companyPhone: i.company_phone || null, companyAddress: i.company_address || null,
    periodStart: i.period_start && ymd(i.period_start), periodEnd: ymd(i.period_end), issuedAt: i.issued_at,
    termsDays: i.terms_days, terms: termsLabel(i.terms_days), dueDate: ymd(i.due_date), totalCents: i.total_cents,
    status: i.status, overdue: i.status === 'open' && ymd(i.due_date) < today,
    sentAt: i.sent_at, sentTo: i.sent_to, remindedAt: i.reminded_at, paidAt: i.paid_at,
    paidMethod: i.paid_method, paidMethodLabel: PAID_METHODS[i.paid_method] || i.paid_method || null, paidNote: i.paid_note,
    publicToken: i.public_token,
    lines: lines && lines.map((l) => ({ id: l.id, orderId: l.order_id, chargeId: l.charge_id, day: ymd(l.day), description: l.description, reference: l.reference, cents: l.cents })),
  };
}

async function listInvoices({ organizationId = null, limit = 200 } = {}) {
  const { rows } = await db.query(
    `SELECT i.*, o.name AS company, o.billing_email FROM invoices i JOIN organizations o ON o.id = i.organization_id
     WHERE ($1::uuid IS NULL OR i.organization_id = $1) ORDER BY i.issued_at DESC LIMIT $2`, [organizationId, limit]);
  return rows.map((r) => serialize(r, null));
}

// Per-company balances for dispatch: billed-on-account companies, plus any company with invoices.
async function accounts() {
  const today = localDate();
  const { rows: orgs } = await db.query(
    `SELECT o.id, o.name, o.billing_email, o.billing_mode, o.payment_terms_days, o.credit_limit_cents,
       COALESCE((SELECT sum(total_cents) FROM invoices WHERE organization_id = o.id AND status = 'open'), 0)::int AS open_cents,
       COALESCE((SELECT sum(total_cents) FROM invoices WHERE organization_id = o.id AND status = 'open' AND due_date < $1), 0)::int AS overdue_cents,
       (SELECT max(issued_at) FROM invoices WHERE organization_id = o.id AND status <> 'void') AS last_invoiced_at
     FROM organizations o
     WHERE o.billing_mode = 'invoice' OR EXISTS (SELECT 1 FROM invoices WHERE organization_id = o.id)
     ORDER BY o.name`, [today]);
  const out = [];
  for (const o of orgs) {
    const { totalCents, lines } = await unbilledItems(db, o.id, today);
    out.push({
      id: o.id, name: o.name, billingEmail: o.billing_email || null, billingMode: o.billing_mode,
      termsDays: o.payment_terms_days, terms: termsLabel(o.payment_terms_days),
      unbilledCents: totalCents, unbilledLines: lines.length, openCents: o.open_cents, overdueCents: o.overdue_cents,
      lastInvoicedAt: o.last_invoiced_at, creditLimitCents: o.credit_limit_cents ?? null,
      overLimit: o.credit_limit_cents != null && o.open_cents + totalCents > o.credit_limit_cents,
    });
  }
  return out;
}

async function markPaid(client, invoiceId, { method, note, actorId }) {
  if (!PAID_METHODS[method]) throw new HttpError(400, `method must be one of ${Object.keys(PAID_METHODS).join(', ')}`);
  const { rows: [inv] } = await client.query(
    `UPDATE invoices SET status = 'paid', paid_at = now(), paid_method = $2, paid_note = $3
     WHERE id = $1 AND status = 'open' RETURNING id, invoice_number`, [invoiceId, method, String(note || '').slice(0, 300) || null]);
  if (!inv) throw new HttpError(409, 'Only open invoices can be marked paid');
  const { rows: orders } = await client.query(
    `UPDATE orders SET payment_status = 'paid', paid_cents = price_cents, paid_at = now(), payment_method = $2, updated_at = now()
     WHERE invoice_id = $1 AND payment_status = 'invoice' RETURNING id, price_cents`, [invoiceId, `invoice_${method}`]);
  for (const o of orders) {
    await client.query('INSERT INTO order_events (order_id, actor_id, type, data) VALUES ($1, $2, $3, $4)',
      [o.id, actorId, 'paid', JSON.stringify({ cents: o.price_cents, method: `invoice ${inv.invoice_number} (${PAID_METHODS[method].toLowerCase()})` })]);
  }
  await client.query("UPDATE order_charges SET status = 'paid', paid_at = now() WHERE invoice_id = $1 AND status = 'invoice'", [invoiceId]);
}

// Voiding frees its orders and charges, so they go on the next invoice (fix a price, then invoice again).
async function voidInvoice(client, invoiceId) {
  const { rows: [inv] } = await client.query(
    "UPDATE invoices SET status = 'void' WHERE id = $1 AND status = 'open' RETURNING id", [invoiceId]);
  if (!inv) throw new HttpError(409, 'Only open invoices can be voided');
  await client.query('UPDATE orders SET invoice_id = NULL WHERE invoice_id = $1', [invoiceId]);
  await client.query('UPDATE order_charges SET invoice_id = NULL WHERE invoice_id = $1', [invoiceId]);
}

const appBase = () => String(process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com').replace(/\/$/, '');
const invoiceUrl = (inv) => `${appBase()}/public/invoice/${inv.publicToken}`;

async function payInstructions() {
  const { rows: [r] } = await db.query("SELECT value FROM settings WHERE key = 'invoicing'");
  return String(r?.value?.payInstructions || '').trim();
}

// The invoice email: the summary, a link to the full invoice (printable, with a CSV) and a card payment link.
async function emailInvoice(inv, { to, reminder = false } = {}) {
  const instructions = await payInstructions();
  const shown = inv.lines.slice(0, 40);
  const rows = shown.map((l) => `<tr>
      <td style="padding:6px;border-top:1px solid #e5e7eb;white-space:nowrap">${esc(longDate(l.day).replace(/, \d{4}$/, ''))}</td>
      <td style="padding:6px;border-top:1px solid #e5e7eb">${esc(l.description)}${l.reference ? `<br><span style="color:#6b7280">PO / ref: ${esc(l.reference)}</span>` : ''}</td>
      <td style="padding:6px;border-top:1px solid #e5e7eb;text-align:right;white-space:nowrap">${money(l.cents)}</td></tr>`).join('');
  const subject = reminder
    ? `Reminder: invoice ${inv.invoiceNumber} for ${money(inv.totalCents)} was due ${longDate(inv.dueDate)}`
    : `Invoice ${inv.invoiceNumber} from Choice Delivery SC: ${money(inv.totalCents)} due ${longDate(inv.dueDate)}`;
  await sendMail({
    to,
    subject,
    replyTo: process.env.LEADS_EMAIL || 'info@choicedeliverysc.com',
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#111827;font-size:14px">
  <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><strong>Choice Delivery SC</strong> · Invoice ${esc(inv.invoiceNumber)}</div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 10px 10px">
    <p>${reminder ? `This is a friendly reminder that invoice <strong>${esc(inv.invoiceNumber)}</strong> is past due.` : `Here is your invoice for deliveries through ${esc(longDate(inv.periodEnd))}.`}</p>
    <table style="border-collapse:collapse;margin:12px 0">
      <tr><td style="color:#6b7280;padding:2px 14px 2px 0">Bill to</td><td>${esc(inv.company)}</td></tr>
      <tr><td style="color:#6b7280;padding:2px 14px 2px 0">Invoice</td><td>${esc(inv.invoiceNumber)} · issued ${esc(longDate(inv.issuedAt instanceof Date ? localDate(inv.issuedAt) : localDate(new Date(inv.issuedAt))))}</td></tr>
      <tr><td style="color:#6b7280;padding:2px 14px 2px 0">Terms</td><td>${esc(inv.terms)}</td></tr>
      <tr><td style="color:#6b7280;padding:2px 14px 2px 0">Due</td><td><strong>${esc(longDate(inv.dueDate))}</strong></td></tr>
      <tr><td style="color:#6b7280;padding:2px 14px 2px 0">Amount due</td><td><strong style="font-size:18px">${money(inv.totalCents)}</strong></td></tr>
    </table>
    <p><a href="${invoiceUrl(inv)}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">View &amp; print invoice</a>
      &nbsp; <a href="${invoiceUrl(inv)}/pay" style="background:#111827;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Pay ${money(inv.totalCents)} by card</a></p>
    ${instructions ? `<p style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;white-space:pre-line"><strong>Other ways to pay</strong><br>${esc(instructions)}</p>` : ''}
    <table style="border-collapse:collapse;width:100%;margin-top:8px">
      <tr><th align="left" style="padding:6px">Date</th><th align="left" style="padding:6px">Delivery</th><th align="right" style="padding:6px">Amount</th></tr>
      ${rows}
      ${inv.lines.length > shown.length ? `<tr><td colspan="3" style="padding:6px;color:#6b7280">…and ${inv.lines.length - shown.length} more on the full invoice.</td></tr>` : ''}
      <tr><td colspan="2" style="padding:8px 6px;border-top:2px solid #111827"><strong>Total</strong></td><td style="padding:8px 6px;border-top:2px solid #111827;text-align:right"><strong>${money(inv.totalCents)}</strong></td></tr>
    </table>
    <p style="color:#6b7280;font-size:12px;margin-top:14px">Questions about this invoice? Just reply to this email. A spreadsheet (CSV) of every line is on the full invoice page.</p>
  </div></div>`,
  });
  return subject;
}

// The full invoice as a standalone printable page (no login; the link is the invoice's own token).
function invoicePage(inv, instructions, { paidNow = false } = {}) {
  const lines = inv.lines.map((l) => `<tr><td class="nowrap">${esc(longDate(l.day))}</td><td>${esc(l.description)}</td>
    <td>${esc(l.reference || '')}</td><td class="num">${money(l.cents)}</td></tr>`).join('');
  const status = inv.status === 'paid' ? `<p class="stamp paid">Paid ${inv.paidAt ? esc(longDate(localDate(inv.paidAt))) : ''} · Thank you!</p>`
    : inv.status === 'void' ? '<p class="stamp void">Void: this invoice was cancelled.</p>'
    : inv.overdue ? `<p class="stamp overdue">Past due: was due ${esc(longDate(inv.dueDate))}</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${esc(inv.invoiceNumber)} · Choice Delivery SC</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#111827;background:#f3f4f6;margin:0;padding:24px}
main{background:#fff;max-width:860px;margin:auto;padding:36px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.06)}
header{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;border-bottom:3px solid #0f766e;padding-bottom:16px}
h1{margin:0;color:#0f766e;font-size:28px}.muted{color:#6b7280}.from p,.meta p{margin:2px 0}
.meta{text-align:right}.cols{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;margin:20px 0}
.due{background:#f0fdfa;border:1px solid #99f6e4;border-radius:10px;padding:12px 16px}.due strong{font-size:22px;color:#0f766e}
table{border-collapse:collapse;width:100%;font-size:14px}th{text-align:left;border-bottom:2px solid #111827;padding:8px 6px}
td{border-bottom:1px solid #e5e7eb;padding:8px 6px;vertical-align:top}.num{text-align:right;white-space:nowrap}.nowrap{white-space:nowrap}
tfoot td{border:0;font-weight:700;font-size:16px;padding-top:12px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}
.btn{display:inline-block;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;border:1px solid #0f766e;color:#0f766e;background:#fff;cursor:pointer;font-size:14px}
.btn.primary{background:#0f766e;color:#fff}.box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;white-space:pre-line}
.stamp{font-weight:700;padding:10px 14px;border-radius:8px}.paid{background:#dcfce7;color:#166534}.void{background:#f3f4f6;color:#374151}.overdue{background:#fee2e2;color:#991b1b}
@media print{body{background:#fff;padding:0}main{box-shadow:none;padding:0;max-width:none}.actions{display:none}@page{size:letter;margin:.5in}}
@media (max-width:600px){main{padding:20px}.meta{text-align:left}}
</style></head><body><main>
<header><div class="from"><h1>Choice Delivery SC</h1><p class="muted">Same-day courier · Columbia, SC</p>
  <p class="muted">info@choicedeliverysc.com · (803) 949-7034 · choicedeliverysc.com</p></div>
  <div class="meta"><h1>Invoice</h1><p><strong>${esc(inv.invoiceNumber)}</strong></p>
  <p class="muted">Issued ${esc(longDate(localDate(inv.issuedAt)))}</p><p class="muted">${esc(inv.terms)}</p></div></header>
${paidNow ? '<p class="stamp paid">Thank you! Your payment went through; this page updates once it\'s recorded.</p>' : ''}${status}
<div class="cols"><div><p class="muted">Bill to</p><p><strong>${esc(inv.company)}</strong></p>${inv.companyAddress ? `<p>${esc(inv.companyAddress)}</p>` : ''}${inv.billingEmail ? `<p>${esc(inv.billingEmail)}</p>` : ''}</div>
  <div><p class="muted">Deliveries</p><p>${inv.periodStart ? `${esc(longDate(inv.periodStart))} – ` : 'Through '}${esc(longDate(inv.periodEnd))}</p></div>
  <div class="due"><p class="muted">${inv.status === 'paid' ? 'Amount paid' : 'Amount due'}</p><strong>${money(inv.totalCents)}</strong><p class="muted">Due ${esc(longDate(inv.dueDate))}</p></div></div>
<div class="actions">${inv.status === 'open' ? `<a class="btn primary" href="${invoiceUrl(inv)}/pay">Pay ${money(inv.totalCents)} by card</a>` : ''}
  <button class="btn" onclick="window.print()">Print / Save as PDF</button><a class="btn" href="${invoiceUrl(inv)}/csv">Download spreadsheet (CSV)</a></div>
<table><thead><tr><th>Date</th><th>Delivery</th><th>PO / reference</th><th class="num">Amount</th></tr></thead><tbody>${lines}</tbody>
<tfoot><tr><td colspan="3">Total</td><td class="num">${money(inv.totalCents)}</td></tr></tfoot></table>
${inv.status === 'open' && instructions ? `<h3>Other ways to pay</h3><p class="box">${esc(instructions)}</p>` : ''}
<p class="muted" style="margin-top:24px;font-size:13px">Please include the invoice number with your payment. Questions? Email info@choicedeliverysc.com.</p>
</main></body></html>`;
}

function invoiceCsv(inv) {
  const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const rows = [['Invoice', 'Date', 'Description', 'PO / reference', 'Amount'],
    ...inv.lines.map((l) => [inv.invoiceNumber, l.day, l.description, l.reference || '', (l.cents / 100).toFixed(2)]),
    [inv.invoiceNumber, '', 'Total', '', (inv.totalCents / 100).toFixed(2)]];
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

// On the 1st of each month (8 AM Columbia time) every company billed on account gets an invoice for last
// month's deliveries. They aren't emailed automatically: the owner gets one email to review and send them.
async function runMonthly(now = new Date(), { force = false } = {}) {
  const today = localDate(now);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(now));
  if (!force && (today.slice(8) !== '01' || hour < 8)) return null;
  const month = today.slice(0, 7);
  const { rowCount } = await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('invoice_run', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     WHERE settings.value->>'month' IS DISTINCT FROM EXCLUDED.value->>'month'`, [JSON.stringify({ month })]);
  if (!rowCount && !force) return null;
  const through = endOfPreviousMonth(today);
  const { rows: orgs } = await db.query("SELECT id, name FROM organizations WHERE billing_mode = 'invoice' AND NOT is_demo ORDER BY name");
  const made = [];
  for (const o of orgs) {
    const id = await db.withTx((client) => createInvoice(client, o.id, { through }));
    if (id) made.push(await getInvoice('id', id));
  }
  if (made.length) {
    await sendMail({
      to: process.env.ORDER_ALERTS_EMAIL || process.env.LEADS_EMAIL || 'info@choicedeliverysc.com',
      subject: `${made.length} invoice${made.length === 1 ? '' : 's'} ready to send: ${money(made.reduce((t, i) => t + i.totalCents, 0))}`,
      html: `<p>Invoices for deliveries through ${esc(longDate(through))} are ready. Review them and tap <strong>Send</strong>:</p>
        <ul>${made.map((i) => `<li>${esc(i.invoiceNumber)} · ${esc(i.company)} · ${money(i.totalCents)} (${esc(i.terms)})</li>`).join('')}</ul>
        <p><a href="${appBase()}/#/invoices">Open invoices</a></p>`,
    }).catch((e) => console.error('Invoice run email failed:', e.message));
  }
  return made;
}

function startMonthlyTimer() {
  const tick = () => runMonthly().catch((e) => console.error('Monthly invoices failed:', e.message));
  setTimeout(tick, 30 * 1000).unref?.();
  setInterval(tick, 10 * 60 * 1000).unref?.();
}

module.exports = {
  TERMS, PAID_METHODS, localDate, unbilledItems, createInvoice, getInvoice, listInvoices, accounts, markPaid, voidInvoice,
  emailInvoice, invoicePage, invoiceCsv, payInstructions, runMonthly, startMonthlyTimer, invoiceUrl, termsLabel,
};
