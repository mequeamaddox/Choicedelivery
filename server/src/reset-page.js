// Older reset links pointed here; the reset form now lives in the web app.
// The token moves into the URL fragment, which browsers never send to servers or in Referer headers.
module.exports = (req, res) => {
  const token = String(req.query.token || '').replace(/[^0-9a-f]/gi, '');
  res.redirect(302, `/#/reset/${token}`);
};
