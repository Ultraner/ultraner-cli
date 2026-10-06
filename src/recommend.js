// Maps questionnaire answers to capabilities the real Ultraner API has today.
// Every capability here exists in public/openapi.json or public/docs.md on
// ultraner.com. If something a user asks for does not exist (split payments,
// seller onboarding, an invoice object), it is listed under `unavailable` with
// the honest workaround, never presented as a feature.
import { readFileSync } from 'node:fs';

const coverage = JSON.parse(readFileSync(new URL('./coverage.json', import.meta.url), 'utf8'));
export const COUNTRIES = coverage.countries;
export const LIVE = COUNTRIES.filter((c) => c.live);
export const PAYOUT_LIVE = COUNTRIES.filter((c) => c.live && c.disbursement === 'live');

const DOCS = 'https://ultraner.com/docs';

export const CAPABILITIES = {
  checkout_sessions: {
    name: 'Checkout sessions (hosted checkout)',
    what: 'Mint a one-time cs_ token per order; the payer picks mobile money, card or PayPal on the hosted /pay page or an embedded iframe.',
    endpoint: 'POST /v0/checkout/sessions',
    doc: `${DOCS}#v0`,
  },
  universal_charge: {
    name: 'Universal Checkout charge',
    what: 'One server-side endpoint for mobile money (USSD push), card (Stripe redirect) and PayPal (redirect).',
    endpoint: 'POST /v0/payments/charge',
    doc: `${DOCS}#v0`,
  },
  recurring: {
    name: 'Recurring plans (subscriptions)',
    what: 'Card and PayPal bill on the gateway schedule; mobile money gets a fresh USSD push each interval. Every plan has a public manage_url.',
    endpoint: 'POST /v1/recurring/plans',
    doc: `${DOCS}#recurring`,
  },
  products: {
    name: 'Product catalog and prices',
    what: 'Products, prices and lookup keys, so a checkout session can be minted from a price_id instead of a raw amount.',
    endpoint: 'POST /v1/business/products',
    doc: `${DOCS}#products`,
  },
  disbursements: {
    name: 'Mobile money payouts (disbursements)',
    what: 'Pay out from your balance to a mobile money wallet. Quote first, then send with a signature key and an Idempotency-Key.',
    endpoint: 'POST /v1/disbursements/quote, POST /v1/disbursements',
    doc: `${DOCS}#payouts`,
  },
  settlements: {
    name: 'Settlements to your own bank account',
    what: 'Withdraw your balance to your own bank account by wire. Works worldwide.',
    endpoint: 'POST /v1/settlements',
    doc: `${DOCS}#payouts`,
  },
  escrow: {
    name: 'Escrow',
    what: 'Hold a buyer payment until the buyer releases it to the seller, or disputes it.',
    endpoint: 'POST /v1/escrow, POST /v1/escrow/{code}/release',
    doc: `${DOCS}#escrow`,
  },
  webhooks: {
    name: 'Webhooks',
    what: 'HMAC-SHA256 signed events (x-ultraner-signature). Act on these, not on the create response.',
    endpoint: 'Console > Webhooks',
    doc: `${DOCS}#webhooks`,
  },
  sandbox: {
    name: 'Sandbox',
    what: 'uk_test_ keys route every call to the -sandbox rails. Phone numbers ending 700000001/2/3 force success/insufficient funds/timeout.',
    endpoint: '/v0-sandbox, /v1-sandbox, ...',
    doc: 'https://ultraner.com/docs.md',
  },
};

export const BUILDING = ['checkout', 'marketplace', 'subscriptions', 'payouts', 'invoices'];
export const METHODS = ['mobile_money', 'card', 'paypal'];

export function findCountry(input) {
  if (!input) return null;
  const q = String(input).trim().toLowerCase();
  return COUNTRIES.find((c) => c.code.toLowerCase() === q || c.name.toLowerCase() === q) || null;
}

/** Normalises raw answers (strings or arrays) into a clean shape. */
export function normaliseAnswers(raw) {
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  const building = list(raw.building).map((s) => s.toLowerCase()).filter((b) => BUILDING.includes(b));
  const methods = list(raw.methods).map((s) => s.toLowerCase().replace(/[\s-]+/g, '_'))
    .map((m) => (m === 'mobile' || m === 'momo' || m === 'mobile_money' ? 'mobile_money' : m === 'cards' ? 'card' : m))
    .filter((m) => METHODS.includes(m));
  const commission = raw.commission === undefined || raw.commission === null || raw.commission === false ? null : Number(raw.commission);
  return {
    building: building.length ? [...new Set(building)] : ['checkout'],
    businessCountry: raw.businessCountry ? String(raw.businessCountry).trim() : '',
    customerCountries: list(raw.customerCountries),
    methods: methods.length ? [...new Set(methods)] : ['mobile_money', 'card'],
    paySellers: raw.paySellers === true || raw.paySellers === 'yes' || raw.paySellers === 'true',
    commission: Number.isFinite(commission) && commission > 0 ? commission : null,
  };
}

export function recommend(rawAnswers) {
  const a = normaliseAnswers(rawAnswers);
  const caps = new Set();
  const warnings = [];
  const unavailable = [];
  const notes = [];

  const wants = (b) => a.building.includes(b);

  // Collecting money is the base of every plan.
  caps.add('checkout_sessions');
  caps.add('universal_charge');

  if (wants('subscriptions')) { caps.add('recurring'); caps.add('products'); }
  if (wants('invoices')) {
    unavailable.push({
      name: 'Invoice objects',
      instead: 'There is no invoice API. Mint one checkout session per invoice (expires_in_minutes up to 43200, 30 days) and send its url, with issue_receipt for a receipt.',
    });
  }

  const marketplace = wants('marketplace');
  const payouts = wants('payouts') || a.paySellers;
  if (marketplace) {
    caps.add('escrow');
    unavailable.push({
      name: 'Split payments and seller onboarding',
      instead: 'Ultraner has no split-payment or connected-account object. Collect into your own balance, optionally hold in escrow, then pay each seller with a disbursement.',
    });
  }
  if (payouts) {
    caps.add('disbursements');
    if (PAYOUT_LIVE.length) {
      notes.push(`Mobile money payouts are live in: ${PAYOUT_LIVE.map((c) => c.name).join(', ')}. Other live markets can collect but not yet pay out to a wallet.`);
    }
    const payoutCountries = [a.businessCountry, ...a.customerCountries].map(findCountry).filter(Boolean);
    const blocked = payoutCountries.filter((c) => !(c.live && c.disbursement === 'live'));
    if (blocked.length) {
      warnings.push(`Mobile money payouts are not live yet in ${[...new Set(blocked.map((c) => c.name))].join(', ')}. Settlement to your own bank account works worldwide.`);
    }
  }
  if (a.commission !== null) {
    if (marketplace || payouts) {
      notes.push(`Platform commission (${a.commission}%) is computed in your code: pay each seller the net amount with a disbursement and keep the rest in your balance. The generated payouts helper does this.`);
    } else {
      notes.push('A platform commission only applies when you pay sellers, so it was ignored.');
    }
  }
  caps.add('settlements');
  caps.add('webhooks');
  caps.add('sandbox');

  // Payment methods vs live coverage.
  if (a.methods.includes('mobile_money')) {
    const all = [a.businessCountry, ...a.customerCountries].filter(Boolean);
    const unknown = all.filter((n) => !findCountry(n));
    const notLive = all.map(findCountry).filter((c) => c && !c.live);
    if (notLive.length) warnings.push(`Mobile money is not live in ${[...new Set(notLive.map((c) => c.name))].join(', ')} yet. Cards and PayPal still work there.`);
    if (unknown.length) warnings.push(`No mobile money coverage data for ${unknown.join(', ')}. Cards and PayPal work worldwide.`);
  }
  if (a.methods.includes('card')) notes.push('Cards go through Stripe on a hosted page; Ultraner never sees a card number.');
  if (a.methods.includes('paypal')) notes.push('PayPal is a redirect to PayPal and back.');

  const biz = findCountry(a.businessCountry);
  const networks = [biz, ...a.customerCountries.map(findCountry)].filter((c) => c && c.live);
  const mobileNetworks = [...new Map(networks.map((c) => [c.code, c])).values()]
    .map((c) => ({ country: c.name, currency: c.currency, networks: c.mnos.map((m) => m.label) }));

  const events = ['payment.success', 'payment.failed'];
  if (caps.has('recurring')) events.push('recurring.activated', 'recurring.success', 'recurring.past_due', 'recurring.failed', 'recurring.cancelled');
  if (caps.has('disbursements')) events.push('disbursement.success', 'disbursement.failed');

  return {
    answers: a,
    capabilities: [...caps].map((id) => ({ id, ...CAPABILITIES[id] })),
    unavailable,
    warnings,
    notes,
    mobileNetworks: a.methods.includes('mobile_money') ? mobileNetworks : [],
    events,
    currency: biz?.currency || null,
    wantsPayouts: payouts,
    wantsRecurring: caps.has('recurring'),
  };
}

export function formatPlan(plan, project) {
  const a = plan.answers;
  const out = [];
  out.push('Ultraner Integration Plan', '');
  if (project?.frameworkName) out.push(`Project:            ${project.frameworkName}${project.typescript ? ' + TypeScript' : ''}`);
  out.push(`Building:           ${a.building.join(', ')}`);
  if (a.businessCountry) out.push(`Business country:   ${a.businessCountry}`);
  if (a.customerCountries.length) out.push(`Customer countries: ${a.customerCountries.join(', ')}`);
  out.push(`Payment methods:    ${a.methods.map((m) => ({ mobile_money: 'Mobile money', card: 'Cards', paypal: 'PayPal' })[m]).join(', ')}`);
  out.push(`Pay sellers:        ${plan.wantsPayouts ? 'Yes' : 'No'}`);
  if (a.commission !== null) out.push(`Platform commission: ${a.commission}%`);
  out.push('', 'Recommended:');
  for (const c of plan.capabilities) out.push(`  + ${c.name}`, `      ${c.endpoint}`, `      ${c.doc}`);
  if (plan.unavailable.length) {
    out.push('', 'Not in the Ultraner API (and what to do instead):');
    for (const u of plan.unavailable) out.push(`  - ${u.name}: ${u.instead}`);
  }
  if (plan.mobileNetworks.length) {
    out.push('', 'Mobile money networks in your markets:');
    for (const m of plan.mobileNetworks) out.push(`  ${m.country} (${m.currency}): ${m.networks.join(', ')}`);
  }
  if (plan.warnings.length) { out.push('', 'Warnings:'); for (const w of plan.warnings) out.push(`  ! ${w}`); }
  if (plan.notes.length) { out.push('', 'Notes:'); for (const n of plan.notes) out.push(`  * ${n}`); }
  out.push('', `Webhook events to subscribe to: ${plan.events.join(', ')}`);
  return out.join('\n');
}
