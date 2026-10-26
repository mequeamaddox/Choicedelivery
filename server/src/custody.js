// Chain-of-custody report for an order: every handoff in time order (who, when, where, signature, piece
// count, seal), built from the order's stops and history. The web app shows and prints it; the email
// version is the same rows without the signature and photo images.
const db = require('./db');

const TEMPERATURE_LABELS = { ambient: 'Room temperature', refrigerated: 'Refrigerated', frozen: 'Frozen' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (d) => (d ? new Date(d).toLocaleString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
}) : '');
// "GPS: 40 ft from the address" from the phone's distance to the stop.
const gps = (m) => (m == null ? null : m < 300 ? `GPS: ${Math.round(m * 3.281)} ft from the address` : `GPS: ${(m / 1609).toFixed(1)} mi from the address`);

async function buildCustody(orderId) {
  const { rows: [o] } = await db.query(
    `SELECT o.*, org.name AS company, u.name AS creator_name, u.email AS creator_email, d.name AS driver_name
     FROM orders o LEFT JOIN organizations org ON org.id = o.organization_id
     LEFT JOIN users u ON u.id = o.created_by LEFT JOIN users d ON d.id = o.driver_id WHERE o.id = $1`, [orderId]);
  if (!o) return null;
  const { rows: stops } = await db.query('SELECT * FROM stops WHERE order_id = $1 ORDER BY sequence', [orderId]);
  const { rows: events } = await db.query(
    `SELECT e.type, e.data, e.created_at, a.name AS actor_name, a.email AS actor_email, a.role AS actor_role
     FROM order_events e LEFT JOIN users a ON a.id = e.actor_id WHERE e.order_id = $1 ORDER BY e.created_at, e.id`, [orderId]);
  const stopLabel = (st) => {
    if (!st) return 'stop';
    if (st.type === 'pickup') return stops.filter((x) => x.type === 'pickup').length > 1 ? `pickup ${st.sequence}` : 'pickup';
    return st.sequence === stops.length ? 'drop-off' : `stop ${st.sequence}`;
  };
  const byId = Object.fromEntries(stops.map((st) => [st.id, st]));
  const who = (e) => e.actor_name || e.actor_email || (e.actor_role ? e.actor_role : 'Customer');

  const entries = [];
  const add = (e, entry) => entries.push({ at: e.created_at, person: null, details: [], exception: false, ...entry });
  for (const e of events) {
    const d = e.data || {};
    const st = byId[d.stopId];
    switch (e.type) {
      case 'created': add(e, { event: 'Order booked', person: e.actor_role === 'shipper' ? who(e) : o.customer_name || who(e) }); break;
      case 'accepted': add(e, { event: 'Driver accepted the job', person: who(e) }); break;
      case 'assigned': add(e, { event: 'Driver assigned by dispatch', person: o.driver_name }); break;
      case 'unassigned': add(e, { event: 'Driver removed by dispatch', person: who(e) }); break;
      case 'barcode_scanned': add(e, { event: 'Package barcode scanned', person: who(e), details: [d.barcode].filter(Boolean) }); break;
      case 'stop_arrived': add(e, { event: `Driver arrived at ${stopLabel(st)}`, person: who(e), address: st?.address, details: [gps(d.distanceM)].filter(Boolean) }); break;
      case 'stop_completed': {
        const pickup = st?.type === 'pickup';
        add(e, {
          event: pickup ? `Picked up (${stopLabel(st)})` : `Delivered (${stopLabel(st)})`,
          person: who(e),
          handedBy: pickup ? st?.printed_name : null,
          receivedBy: pickup ? null : st?.printed_name,
          address: st?.address,
          signature: st?.signature || null,
          photo: st?.photo || null,
          pieceCount: st?.piece_count ?? null,
          sealSeen: st?.seal_seen || null,
          details: [gps(d.distanceM), st?.barcode ? `Barcode ${st.barcode}` : null].filter(Boolean),
        });
        break;
      }
      case 'custody_exception': add(e, { event: `Exception at ${stopLabel(st)}`, person: who(e), details: d.problems || [], exception: true }); break;
      case 'marked_delivered': add(e, { event: 'Marked delivered by dispatch (no driver proof)', person: who(e), details: [d.reason].filter(Boolean), exception: true }); break;
      case 'cancelled': add(e, { event: 'Order cancelled', person: who(e), details: [d.reason].filter(Boolean), exception: true }); break;
      case 'note_added': break;
      default: break;
    }
  }
  return {
    orderNumber: o.order_number,
    generatedAt: new Date().toISOString(),
    status: o.status,
    custodyRequired: !!o.custody_required,
    customer: o.company || o.customer_name || o.creator_name || o.creator_email || '',
    description: o.description || '',
    reference: o.tracking_number || '',
    pieces: o.number_of_pieces || '',
    sealNumber: o.seal_number || '',
    temperature: TEMPERATURE_LABELS[o.temperature] || '',
    driver: o.driver_name || '',
    from: stops[0]?.address || '',
    to: stops[stops.length - 1]?.address || '',
    entries: entries.map((x) => ({ ...x, at: x.at instanceof Date ? x.at.toISOString() : x.at })),
    exceptions: entries.filter((x) => x.exception).length,
  };
}

// Email version: the same rows, with "signature on file" in place of the images (most inboxes block them).
function custodyEmailHtml(c, note) {
  const fact = (k, v) => (v ? `<tr><td style="color:#6b7280;padding:2px 12px 2px 0">${k}</td><td>${esc(v)}</td></tr>` : '');
  const rows = c.entries.map((x) => `<tr style="${x.exception ? 'background:#fef2f2' : ''}">
      <td style="padding:6px;border-top:1px solid #e5e7eb;white-space:nowrap;vertical-align:top">${esc(when(x.at))}</td>
      <td style="padding:6px;border-top:1px solid #e5e7eb;vertical-align:top"><strong>${esc(x.event)}</strong>
        ${x.address ? `<br><span style="color:#6b7280">${esc(x.address)}</span>` : ''}
        ${x.handedBy ? `<br>Handed over by: ${esc(x.handedBy)}` : ''}${x.receivedBy ? `<br>Received by: ${esc(x.receivedBy)}` : ''}
        ${x.pieceCount != null ? `<br>Pieces counted: ${x.pieceCount}` : ''}${x.sealSeen ? `<br>Seal: ${esc(x.sealSeen)}` : ''}
        ${x.details.length ? `<br><span style="color:${x.exception ? '#b91c1c' : '#6b7280'}">${x.details.map(esc).join(' · ')}</span>` : ''}
        ${x.signature || x.photo ? `<br><span style="color:#6b7280">${[x.signature && 'Signature on file', x.photo && 'Photo on file'].filter(Boolean).join(' · ')}</span>` : ''}</td>
      <td style="padding:6px;border-top:1px solid #e5e7eb;vertical-align:top">${esc(x.person || '')}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#111827;font-size:14px">
  <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><strong>Choice Delivery SC · Chain of custody</strong></div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 10px 10px">
    ${note ? `<p>${esc(note)}</p>` : ''}
    <table style="border-collapse:collapse;margin-bottom:14px">
      ${fact('Order', c.orderNumber)}${fact('Customer', c.customer)}${fact('Reference', c.reference)}${fact('Contents', c.description)}
      ${fact('Pieces', c.pieces)}${fact('Seal number', c.sealNumber)}${fact('Temperature', c.temperature)}
      ${fact('From', c.from)}${fact('To', c.to)}${fact('Driver', c.driver)}
    </table>
    ${c.exceptions ? `<p style="color:#b91c1c"><strong>${c.exceptions} exception${c.exceptions === 1 ? '' : 's'} recorded</strong> (highlighted below).</p>` : ''}
    <table style="border-collapse:collapse;width:100%">
      <tr><th align="left" style="padding:6px">Time (Eastern)</th><th align="left" style="padding:6px">Event</th><th align="left" style="padding:6px">By</th></tr>
      ${rows}
    </table>
    <p style="color:#6b7280;font-size:12px;margin-top:14px">Times and GPS positions are recorded automatically by the driver's phone.
      Signatures and delivery photos are kept on file; reply to this email for copies. Report generated ${esc(when(c.generatedAt))}.</p>
  </div></div>`;
}

module.exports = { buildCustody, custodyEmailHtml, TEMPERATURE_LABELS, when };
