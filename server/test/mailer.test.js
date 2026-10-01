const { test } = require('node:test');
const assert = require('node:assert/strict');
const { htmlToText } = require('../src/mailer');

test('emails get a plain-text copy with readable links', () => {
  assert.equal(
    htmlToText('<p>Hi <strong>Jo</strong> &amp; co,</p><p><a href="https://app.x/#/track/a">Track it</a></p><ul><li>One</li></ul><p>Bye<br>CD</p>'),
    'Hi Jo & co,\n\nTrack it (https://app.x/#/track/a)\n\n• One\n\nBye\nCD');
  assert.equal(htmlToText('<a href="https://x.y">https://x.y</a>'), 'https://x.y');
});
