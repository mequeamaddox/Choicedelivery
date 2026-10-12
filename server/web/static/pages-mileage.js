// Mileage log for taxes: miles counted while online in the driver app, plus trips added by hand.
// Drivers see their own (#/driver/mileage); staff see a driver's on the driver's page.
import { html, useState, api, useApi } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Empty, Field, ActionButton } from './components.js';

const miles = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })} mi`;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const monthLabel = (d) => new Date(`${d.slice(0, 7)}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

function downloadCsv(log, name) {
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [['Date', 'Tracked miles', 'Added miles', 'Total miles', 'Miles on a job', 'Jobs completed', 'Notes']];
  for (const d of [...log.days].reverse()) {
    rows.push([d.day, d.trackedMiles, d.addedMiles, d.totalMiles, d.jobMiles, d.jobs.join(' '),
      d.entries.map((e) => `${e.miles} mi${e.note ? `: ${e.note}` : ''}`).join('; ')]);
  }
  rows.push(['Total', log.totals.trackedMiles, log.totals.addedMiles, log.totals.totalMiles, log.totals.jobMiles, '', '']);
  const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mileage-${name ? `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-` : ''}${log.year}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function AddTrip({ query, onAdded }) {
  const [v, setV] = useState({ day: today(), miles: '', note: '' });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError(null); setSaved(false);
    try {
      await api(`/mileage/entries${query}`, { method: 'POST', body: { day: v.day, miles: Number(v.miles), note: v.note } });
      setV({ ...v, miles: '', note: '' }); setSaved(true); onAdded();
    } catch (x) { setError(x); }
  };
  return html`
    <form class="card" onSubmit=${submit}>
      <h2>Add a trip the app missed</h2>
      <p class="small muted">For business driving while the app was off: a supply run, the bank, a pickup you drove to before going online.</p>
      <${Alert} error=${error} />
      ${saved && html`<${Alert} tone="success">Trip added.<//>`}
      <div class="grid-2">
        <${Field} label="Date"><input type="date" required max=${today()} value=${v.day} onInput=${(e) => setV({ ...v, day: e.target.value })} /><//>
        <${Field} label="Miles"><input type="number" required min="0.1" max="2000" step="0.1" inputmode="decimal" value=${v.miles}
          onInput=${(e) => setV({ ...v, miles: e.target.value })} /><//>
      </div>
      <${Field} label="What it was for" hint="Where you went and why, e.g. Supply run to Ferguson for CD-100123.">
        <input maxlength="200" value=${v.note} onInput=${(e) => setV({ ...v, note: e.target.value })} /><//>
      <div class="actions"><button class="btn primary">Add trip</button></div>
    </form>`;
}

// The log itself. driverId: staff viewing a driver; omitted for the driver's own log.
export function MileageLog({ driverId, driverName }) {
  const thisYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const query = driverId ? `?driverId=${encodeURIComponent(driverId)}` : '';
  const log = useApi(`/mileage${query}${query ? '&' : '?'}year=${year}`);
  const [error, setError] = useState(null);
  const l = log.data;
  const month = today().slice(0, 7);
  const monthTotal = l ? l.days.filter((d) => d.day.startsWith(month)).reduce((s, d) => s + d.totalMiles, 0) : 0;
  const months = [];
  for (const d of l?.days || []) {
    const key = d.day.slice(0, 7);
    if (months[months.length - 1]?.key !== key) months.push({ key, days: [], total: 0 });
    const m = months[months.length - 1];
    m.days.push(d); m.total += d.totalMiles;
  }
  const remove = (entry) => async () => {
    await api(`/mileage/entries/${entry.id}${query}`, { method: 'DELETE' });
    log.reload();
  };
  return html`
    <div class="stack">
      <div class="inline mileage-bar">
        <select aria-label="Year" value=${year} onChange=${(e) => setYear(Number(e.target.value))}>
          ${[thisYear, thisYear - 1, thisYear - 2].map((y) => html`<option value=${y}>${y}</option>`)}
        </select>
        ${l && html`<button type="button" class="btn" onClick=${() => downloadCsv(l, driverName)}>Download for taxes (CSV)</button>`}
      </div>
      ${l && html`<div class="stat-row">
        ${year === thisYear && html`<div class="stat"><span class="muted small">This month</span><strong>${miles(monthTotal)}</strong></div>`}
        <div class="stat"><span class="muted small">${year}</span><strong>${miles(l.totals.totalMiles)}</strong></div>
        <div class="stat"><span class="muted small">On a job, ${year}</span><strong>${miles(l.totals.jobMiles)}</strong></div>
      </div>`}
      <${AddTrip} query=${query} onAdded=${log.reload} />
      <${Alert} error=${error || log.error} />
      ${log.loading && !l ? html`<${Spinner} />` : !months.length ? html`<${Empty} title=${`No miles logged in ${year}`}>Miles are counted automatically while you're online in the Choice Delivery app.<//>` : months.map((m) => html`
        <section class="card" key=${m.key}>
          <h2>${monthLabel(m.key)} <span class="muted small">· ${miles(m.total)}</span></h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Day</th><th>Miles</th><th>Jobs</th><th>Added trips</th></tr></thead>
            <tbody>${m.days.map((d) => html`<tr key=${d.day}>
              <td data-label="Day">${dayLabel(d.day)}</td>
              <td data-label="Miles"><strong>${miles(d.totalMiles)}</strong>${d.addedMiles > 0 && html` <span class="muted small">(${miles(d.trackedMiles)} tracked)</span>`}</td>
              <td data-label="Jobs">${d.jobs.length ? d.jobs.join(', ') : html`<span class="muted">—</span>`}</td>
              <td data-label="Added trips">${d.entries.length ? d.entries.map((e) => html`<div key=${e.id} class="small">
                ${miles(e.miles)}${e.note && ` · ${e.note}`}
                <${ActionButton} class="link small" onError=${setError} confirmText="Remove this trip?" onClick=${remove(e)}>Remove<//></div>`)
                : html`<span class="muted">—</span>`}</td>
            </tr>`)}</tbody>
          </table></div>
        </section>`)}
      <p class="small muted">Miles are counted automatically while you're online in the Choice Delivery app with location on.
        Time with the app closed or no signal isn't counted, so add those trips above. Keep this log with your tax records;
        your tax preparer can tell you which miles you can deduct.</p>
    </div>`;
}

export function DriverMileagePage() {
  return html`
    <${Layout}>
      <${PageHeader} title="Mileage" subtitle="Your business miles, for taxes." />
      <${MileageLog} />
    <//>`;
}
