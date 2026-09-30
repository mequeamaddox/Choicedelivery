// Minimal web page linked from password-reset emails.
module.exports = (req, res) => {
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset password</title>
<style>body{font-family:system-ui,sans-serif;max-width:360px;margin:48px auto;padding:0 16px}
input,button{width:100%;padding:12px;margin:8px 0;font-size:16px;box-sizing:border-box}
button{background:#000;color:#fff;border:0;border-radius:6px}</style></head>
<body><h2>Choose a new password</h2>
<form id="f"><input id="p" type="password" placeholder="New password (8+ characters)" minlength="8" required>
<button>Save password</button></form><p id="m"></p>
<script>
const token = new URLSearchParams(location.search).get('token');
document.getElementById('f').onsubmit = async (e) => {
  e.preventDefault();
  const r = await fetch('/auth/reset-password', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({token, password: document.getElementById('p').value})});
  document.getElementById('m').textContent = (await r.json()).message;
  if (r.ok) document.getElementById('f').remove();
};
</script></body></html>`);
};
