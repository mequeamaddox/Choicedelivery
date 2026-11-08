// The independent contractor driver agreement drivers fill out and sign in the app (#/driver/agreement).
// The pay section uses the live driver pay settings. Each signature stores the exact text the driver saw,
// so later edits here never change an agreement someone already signed. Change VERSION when the wording
// changes.
const db = require('./db');
const { getFees } = require('./pricing');
const { HttpError, str } = require('./util');

const VERSION = '2026-11-08';
const pct = (n) => `${Number(n)}%`;
const money = (c) => `$${(c / 100).toFixed(2)}`;

function sections(fees) {
  const d = fees.driverPay;
  return [
    ['Term', 'This Agreement starts on the date Company approves Driver to drive in the Choice Driver app and continues until either Party ends it. Either Party may end it at any time, for any reason, by written notice (text message, email or the app is enough). Jobs Driver has already accepted should be completed or handed back to dispatch before Driver stops.'],
    ['The Services', 'Driver will pick up and deliver shipments for Company’s customers ("Jobs"), mainly in Columbia and the Midlands of South Carolina, using the Choice Driver app. Company offers Jobs through the app; Driver decides whether to accept each one.', [
      'Driver chooses when to go online, which Jobs to accept, and the route to take. There are no required hours, shifts or minimum number of Jobs.',
      'Driver may work for other companies and delivery apps. While carrying a Company shipment, Driver will not pick up or carry another company’s orders, so every Company shipment goes straight from pickup to drop-off.',
      'Once Driver accepts a Job, Driver agrees to complete it as booked, including the pickup time and, for Rush Jobs, driving directly to the drop-off.',
    ]],
    ['Driver Requirements', 'To accept Jobs, Driver must have, and keep:', [
      'an age of at least 21 and a valid driver’s license;',
      'a registered, safe and clean vehicle that fits the Jobs Driver accepts;',
      'auto insurance in Driver’s name, at least South Carolina’s legal minimums, that covers using the vehicle for deliveries;',
      'a smartphone that can run the Choice Driver app, with location services on; and',
      'a background check and driving record (MVR) check that Company finds acceptable.',
    ], 'Driver will tell Company within 48 hours of any accident, ticket for a moving violation, criminal charge, license suspension, or lapse or change in insurance.'],
    ['Payment Amount', 'For each completed Job, Company pays Driver the amount shown in the app when Driver accepts the Job ("Job Pay"). Unless Company sets a different amount for a Job, Job Pay is:', [
      `${money(d.perJobCents)} per Job; plus`,
      `${pct(d.mileagePercent)} of the Job’s mileage charges (distance, travel to a far pickup, and any fuel surcharge); plus`,
      `${pct(d.rushPercent)} of the Rush fee, if the Job is Rush; plus`,
      `${pct(d.extrasPercent)} of extra charges the customer pays for that Job (for example wait time, return trips, failed attempts, or the cancellation fee when a customer cancels after Driver is on the way).`,
    ], 'Job Pay is never more than the customer’s price for the Job. Company may change these rates for future Jobs with at least 7 days’ notice in the app or by email; Jobs already accepted are paid at the rate shown when accepted. Tips, if a customer gives one, belong to Driver.'],
    ['Payment Method', 'Company pays Driver weekly, by direct deposit every Wednesday, for all completed Jobs not yet paid. Driver sets up the payout account in the app. Driver may also cash out earned Job Pay sooner with instant pay; a fee of $1.50 plus 1.5% is taken out of instant payouts. If a Job is disputed (for example, missing proof of delivery or a damage claim), Company may hold that Job’s pay until it is resolved and will tell Driver why.'],
    ['Expenses and Taxes', 'Driver pays all costs of doing the Services, including the vehicle, fuel, maintenance, tolls, parking, phone and data. Company does not withhold Social Security, Medicare or income taxes; Driver is solely responsible for all taxes on Job Pay. Driver will give Company a completed IRS Form W-9, and Company will issue a Form 1099 as the law requires.'],
    ['Doing the Job: the App and Proof of Delivery', 'For every Job, Driver will:', [
      'use the Choice Driver app to accept the Job, mark arrival at each stop, and complete each stop;',
      'take a clear photo and get the recipient’s signature and printed name at drop-off (and at pickup when the app asks), and scan the package barcode when there is one;',
      'on medical Jobs marked "Chain of custody", count the pieces and check the seal number at every handoff and record any difference in the app;',
      `wait at least ${fees.waitFreeMinutes} minutes at a stop before calling dispatch if no one is available, and never leave a shipment unattended unless the customer’s instructions or dispatch say to; and`,
      'contact dispatch at (803) 949-7034 right away about any delay, problem, or a shipment that doesn’t match the order.',
    ], 'Driver understands that the app shares Driver’s location with Company and the customer while Driver is online or on a Job, and records the time and GPS location of each arrival, pickup and delivery.'],
    ['Handling Shipments', 'Driver will:', [
      'never open, tamper with, or repackage a shipment, and keep shipments secure and out of sight in the vehicle;',
      'carry no passengers or animals while carrying a Company shipment;',
      'carry medical specimens only when they are sealed and labeled by the sender, keep them upright and at the temperature shown on the order, and never carry medical waste; and',
      'refuse any shipment that looks unsafe or that Company’s Terms do not allow (such as hazardous materials, weapons, cash or illegal items), and tell dispatch.',
    ], `Customers are responsible for loading and unloading. Driver is not required to lift anything and may decline a Job that Driver can’t safely handle. If a Job is booked with loading help, no single piece will be over ${fees.maxPieceLbs} lbs.`],
    ['Safety and Conduct', 'Driver will obey all traffic laws, use the phone only hands-free while driving, and be courteous and professional with customers. Driver will never drive or do the Services under the influence of alcohol, marijuana, or any drug that impairs driving. Doing so ends this Agreement immediately.'],
    ['Accidents, Damage and Loss', 'Driver will report any accident, injury, or damaged, lost or stolen shipment to Company immediately, and in any case before the end of that day. Company carries cargo insurance for customers’ shipments. Driver is responsible for Driver’s own vehicle, auto insurance and any injury to Driver. Driver agrees to repay Company for any loss, including any insurance deductible, caused by Driver’s theft, intentional act, gross negligence, or failure to follow the Handling Shipments section.'],
    ['Confidentiality and Privacy', 'Customer names, addresses, phone numbers, delivery details, photos, signatures and any medical or legal information Driver sees are confidential. Driver will use them only to do the Services and will not share them, post them online, or keep copies, during or after this Agreement. Driver will not take photos other than those the app asks for.'],
    ['Company’s Customers', 'During this Agreement and for 12 months after it ends, Driver will not use Company’s confidential information to take Company’s customers’ deliveries directly or for another courier.'],
    ['Independent Contractor Status', 'Driver is an independent contractor, not an employee, partner, agent or joint venturer of Company. Driver is not eligible for employee benefits, workers’ compensation or unemployment benefits through Company. Driver has no authority to sign or promise anything on Company’s behalf. Driver controls how the Services are performed, subject to the customer’s instructions and this Agreement.'],
    ['Indemnity', 'Driver will defend and hold Company harmless from claims, costs and damages, including reasonable attorney’s fees, caused by Driver’s negligence, unsafe driving, breaking the law, or breaking this Agreement.'],
    ['Return of Property', 'When this Agreement ends, Driver will return any Company property (such as bags, coolers, signs or ID badges) and any shipment still in Driver’s possession. Company may hold final pay until these are returned.'],
    ['Deactivation', 'Company may stop offering Jobs to Driver at once for: an unsafe driving record, a failed background check, a lapse in license or insurance, impairment, theft or tampering, falsifying proof of delivery, sharing customer information, or repeated customer complaints or missed Jobs. Driver will be paid for Jobs completed before deactivation, less any amount owed under the Accidents, Damage and Loss section.'],
    ['Governing Law', 'This Agreement is governed by the laws of the State of South Carolina. Any lawsuit about this Agreement will be brought in the courts of Richland County, South Carolina.'],
    ['Severability and No Waiver', 'If any part of this Agreement is found unenforceable, the rest stays in effect. Not enforcing a part of this Agreement once is not a waiver of it later.'],
    ['Electronic Signature', 'The Parties agree that signing this Agreement electronically in the app has the same effect as signing it on paper. Driver can view and print the signed copy in the app at any time.'],
    ['Entire Agreement', 'This Agreement is the entire agreement between the Parties about Driver’s Services and replaces any earlier understanding. Except for pay-rate updates under Payment Amount, changes must be in writing and agreed by both Parties.'],
  ].map(([title, text, bullets = [], after = '']) => ({ title, text, bullets, after }));
}

async function current() {
  const fees = await getFees(db);
  return {
    version: VERSION,
    title: 'Independent Contractor Driver Agreement',
    intro: 'This Agreement is between Choice Delivery SC, a courier service based in Columbia, South Carolina ("Company"), and the driver who signs below ("Driver"). In exchange for the promises in this Agreement, Company and Driver (the "Parties") agree as follows:',
    sections: sections(fees),
  };
}

const serialize = (a) => a && ({
  id: a.id, version: a.version, signedAt: a.signed_at, legalName: a.legal_name, address: a.address, city: a.city,
  state: a.state, zip: a.zip, phone: a.phone, email: a.email, consents: a.consents, signature: a.signature,
  document: a.document, ip: a.ip,
});

async function latestFor(userId) {
  const { rows: [a] } = await db.query('SELECT * FROM driver_agreements WHERE user_id = $1 ORDER BY signed_at DESC LIMIT 1', [userId]);
  return serialize(a) || null;
}

const CONSENTS = ['contractor', 'background', 'agree'];
async function sign(user, body, req) {
  const b = body || {};
  const f = { legalName: str(b.legalName).slice(0, 120), address: str(b.address).slice(0, 200), city: str(b.city).slice(0, 80),
    state: str(b.state).toUpperCase().slice(0, 2), zip: str(b.zip).slice(0, 10), phone: str(b.phone).slice(0, 40) };
  if (f.legalName.split(/\s+/).length < 2) throw new HttpError(400, 'Enter your full legal name (first and last)');
  if (!f.address || !f.city || !/^[A-Z]{2}$/.test(f.state) || !/^\d{5}(-\d{4})?$/.test(f.zip)) {
    throw new HttpError(400, 'Enter your full mailing address: street, city, 2-letter state and ZIP');
  }
  if (f.phone.replace(/\D/g, '').length < 10) throw new HttpError(400, 'Enter your phone number');
  if (!CONSENTS.every((k) => b.consents?.[k] === true)) throw new HttpError(400, 'Check all three boxes to sign');
  const signature = String(b.signature || '');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > 400000) {
    throw new HttpError(400, 'Sign in the box with your finger or mouse');
  }
  const doc = await current();
  const { rows: [me] } = await db.query('SELECT email FROM users WHERE id = $1', [user.id]);
  const { rows: [a] } = await db.query(
    `INSERT INTO driver_agreements (user_id, version, legal_name, address, city, state, zip, phone, email, consents, signature, document, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
    [user.id, doc.version, f.legalName, f.address, f.city, f.state, f.zip, f.phone, me.email,
      JSON.stringify({ contractor: true, background: true, agree: true }), signature, JSON.stringify(doc),
      req.ip, str(req.get('user-agent')).slice(0, 300)]);
  return serialize(a);
}

module.exports = { VERSION, current, latestFor, sign };
