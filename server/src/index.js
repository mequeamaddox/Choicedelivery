// Starts the server. If setup is incomplete (missing variables, database unreachable), it does NOT
// crash: it keeps running and explains the problem at every URL (and /health), so the fix is visible
// from a browser instead of buried in a crash loop.
const http = require('http');

const port = process.env.PORT || 3000;

// Listen right away (Railway's health check shouldn't wait on the database) and swap the handler
// once startup finishes: the real app, or a page explaining what's wrong.
let handler = (req, res) => {
  res.writeHead(req.url.startsWith('/health') ? 200 : 503, { 'Content-Type': 'application/json', 'Retry-After': '5' });
  res.end(JSON.stringify({ ok: false, starting: true, message: 'Starting up, connecting to the database…' }));
};
http.createServer((req, res) => handler(req, res))
  .listen(port, '0.0.0.0', () => console.log(`Listening on :${port}`));

// Never echo connection strings (they contain the database password).
const scrub = (s) => String(s).replace(/postgres(ql)?:\/\/[^\s'"]+/gi, 'postgres://***');

function explainDbError(err) {
  const code = err && (err.code || err.errno);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return ['The database address in DATABASE_URL could not be found.', 'Copy the connection string from Neon again (Dashboard → Connect) and paste it into Railway → Variables → DATABASE_URL.'];
  }
  if (code === '28P01' || code === '28000') {
    return ['The database rejected the username or password in DATABASE_URL.', 'In Neon, reset or copy the password again (Dashboard → Connect), then update DATABASE_URL in Railway.'];
  }
  if (code === '3D000') {
    return ['The database named in DATABASE_URL does not exist.', 'Use the connection string exactly as Neon shows it; the database is usually "neondb".'];
  }
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || /timeout/i.test(err && err.message)) {
    return ['Could not reach the database (connection refused or timed out).', 'Check that the Neon project is active and DATABASE_URL points to it.'];
  }
  return [`Could not prepare the database: ${scrub(err && err.message)}`, 'Send this message to your developer.'];
}

function serveSetupProblem(problem, fix) {
  console.error(`\n*** SETUP PROBLEM: ${problem}\n*** HOW TO FIX: ${fix}\n`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  handler = (req, res) => {
    if (req.url.startsWith('/health')) {
      // 200 so Railway keeps this running and the message stays reachable.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, setupProblem: problem, howToFix: fix }));
    }
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Choice Delivery — setup needed</title>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#111827">
<h1 style="color:#0f766e">Almost there — setup needed</h1>
<p><strong>Problem:</strong> ${esc(problem)}</p><p><strong>How to fix:</strong> ${esc(fix)}</p>
<p style="color:#4b5563">After changing variables in Railway, redeploy. This page disappears once everything is set.</p></body>`);
  };
}

async function start() {
  const missing = ['DATABASE_URL', 'JWT_SECRET'].filter((k) => !String(process.env[k] || '').trim());
  if (missing.length) {
    return serveSetupProblem(
      `Missing Railway variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
      `In Railway, open this service → Variables → New Variable and add ${missing.join(' and ')}. `
      + 'DATABASE_URL is your Neon connection string; JWT_SECRET is any long random string (40+ letters and numbers).'
    );
  }

  let app;
  let db;
  try {
    db = require('./db');
    app = require('./app');
  } catch (err) {
    return serveSetupProblem(scrub(err.message), 'Check the variables in Railway → Variables, then redeploy.');
  }

  // Neon databases can take a few seconds to wake up, so retry before giving up.
  let lastErr;
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await db.migrate();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.error(`Database not ready (attempt ${attempt}/${attempts}): ${scrub(err.message)}`);
      if (['28P01', '28000', '3D000', 'ENOTFOUND'].includes(err.code)) break; // retrying won't help
      if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  if (lastErr) {
    const [problem, fix] = explainDbError(lastErr);
    return serveSetupProblem(problem, fix);
  }

  handler = app;
  console.log(`Choice Delivery API ready on :${port}`);

  // Payments: create/verify the Stripe webhook in the background (never blocks startup).
  require('./stripe').ensureWebhook(db)
    .then((r) => console.log(`Stripe webhook: ${r.status}${r.url ? ` (${r.url}, ${r.mode} mode)` : ''}${r.reason ? ` - ${r.reason}` : ''}`))
    .catch((e) => console.error('Stripe webhook setup failed:', e.message));
}

start();
