// Messages between dispatch and drivers. Dispatch: #/messages (every driver, plus a message to all drivers)
// and #/messages/:driverId (one conversation; ?order=<id>&about=<order number> starts a message about an
// order). Drivers: #/driver/messages (their conversation with dispatch).
import { html, useState, useEffect, useRef, api, useApi, currentPath, timeAgo } from './lib.js';
import { Layout, PageHeader, Alert, Spinner, Empty } from './components.js';

const when = (d) => {
  const t = new Date(d);
  const today = new Date().toDateString() === t.toDateString();
  return today ? t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// The conversation (oldest at the top, newest at the bottom) and the box to reply.
// mine(m): whether the reader sent it. send(body): posts it.
function Chat({ messages, mine, send, placeholder, initial = '', onSent }) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages?.length]);
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try { await send(text.trim()); setText(''); onSent?.(); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return html`
    <section class="card chat">
      ${!messages?.length ? html`<p class="muted small">No messages yet.</p>` : html`
        <div class="chat-list">
          ${messages.map((m) => html`<div key=${m.id} class=${`bubble ${mine(m) ? 'mine' : 'theirs'}`}>
            ${m.broadcast && html`<div class="bubble-tag">To all drivers</div>`}
            ${m.orderNumber && html`<div class="bubble-tag">About ${m.orderNumber}</div>`}
            <div class="bubble-body">${m.body}</div>
            <div class="bubble-meta">${m.fromStaff && m.senderName ? `${m.senderName} · ` : ''}${when(m.createdAt)}${mine(m) && m.readAt ? ' · Read' : ''}</div>
          </div>`)}
          <div ref=${end}></div>
        </div>`}
      <form class="chat-form" onSubmit=${submit}>
        <${Alert} error=${error} />
        <textarea rows="2" maxlength="2000" placeholder=${placeholder} value=${text} onInput=${(e) => setText(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }}></textarea>
        <button class="btn primary" disabled=${busy || !text.trim()}>${busy ? 'Sending…' : 'Send'}</button>
      </form>
    </section>`;
}

function BroadcastForm({ onSent }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || !window.confirm('Send this to every driver?')) return;
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await api('/messages/broadcast', { method: 'POST', body: { body: text.trim() } });
      setDone(`Sent to ${r.sent} driver${r.sent === 1 ? '' : 's'}.`); setText(''); onSent();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return html`
    <details class="card">
      <summary><strong>Message all drivers</strong> <span class="muted small">· one announcement to every driver</span></summary>
      <form class="stack" style="margin-top:12px" onSubmit=${submit}>
        <${Alert} error=${error} />
        ${done && html`<${Alert} tone="success">${done}<//>`}
        <textarea rows="3" maxlength="2000" placeholder="e.g. Walmart shift tomorrow at 8 AM. Reply if you can make it."
          value=${text} onInput=${(e) => setText(e.target.value)}></textarea>
        <div><button class="btn primary" disabled=${busy || !text.trim()}>${busy ? 'Sending…' : 'Send to all drivers'}</button></div>
      </form>
    </details>`;
}

export function MessagesPage() {
  const list = useApi('/messages', { pollMs: 10000 });
  return html`
    <${Layout}>
      <${PageHeader} title="Messages" subtitle="Your conversations with drivers. They get a phone alert for each message." />
      <${Alert} error=${list.error} />
      <${BroadcastForm} onSent=${() => list.reload()} />
      ${list.loading && !list.data ? html`<${Spinner} />` : !list.data?.length ? html`<${Empty} title="No drivers yet" />` : html`
        <section class="card thread-list">
          ${list.data.map((t) => html`<a key=${t.driver.id} class="thread-row" href=${`#/messages/${t.driver.id}`}>
            <div class="thread-main">
              <strong>${t.driver.isOnline ? '● ' : ''}${t.driver.name}</strong>
              <div class="muted small thread-last">${t.last ? `${t.last.fromStaff ? 'You: ' : ''}${t.last.body}` : 'No messages yet'}</div>
            </div>
            <div class="thread-side">
              ${t.last && html`<span class="muted small">${timeAgo(t.last.createdAt)}</span>`}
              ${t.unread > 0 && html`<span class="badge red">${t.unread}</span>`}
            </div>
          </a>`)}
        </section>`}
    <//>`;
}

export function MessageThreadPage({ driverId }) {
  const r = useApi(`/messages/${driverId}`, { pollMs: 5000 });
  const q = new URLSearchParams(currentPath().split('?')[1] || '');
  const orderId = q.get('order');
  const about = q.get('about');
  return html`
    <${Layout}>
      <a class="back" href="#/messages">← Messages</a>
      <${PageHeader} title=${r.data?.driver.name || 'Driver'} subtitle=${r.data ? (r.data.driver.isOnline ? 'Online now' : 'Offline · they still get a phone alert') : ''} />
      <${Alert} error=${r.error} />
      ${r.loading && !r.data ? html`<${Spinner} />` : r.data && html`<${Chat} messages=${r.data.messages} mine=${(m) => m.fromStaff}
        initial=${about ? `About ${about}: ` : ''} placeholder=${`Message ${r.data.driver.name}`}
        send=${(body) => api(`/messages/${driverId}`, { method: 'POST', body: { body, orderId: orderId || undefined } })}
        onSent=${() => r.reload()} />`}
    <//>`;
}

export function DriverMessagesPage() {
  const r = useApi('/messages/me', { pollMs: 5000 });
  return html`
    <${Layout}>
      <${PageHeader} title="Messages" subtitle="Your messages with dispatch." />
      <${Alert} error=${r.error} />
      ${r.loading && !r.data ? html`<${Spinner} />` : html`<${Chat} messages=${r.data || []} mine=${(m) => !m.fromStaff}
        placeholder="Message dispatch" send=${(body) => api('/messages/me', { method: 'POST', body: { body } })} onSent=${() => r.reload()} />`}
    <//>`;
}
