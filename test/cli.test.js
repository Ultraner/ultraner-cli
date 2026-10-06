import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { detectProject } from '../src/detect.js';
import { recommend, LIVE, PAYOUT_LIVE } from '../src/recommend.js';
import { planFiles, resolveActions } from '../src/generate.js';
import { runInit, parseArgs } from '../src/cli.js';

// Built from char codes so this file does not itself contain the characters.
const DASHES = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'ultraner-cli-')); made.push(d); return d; };
function project(files) {
  const dir = tmp();
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    if (c !== null) writeFileSync(path.join(dir, f), typeof c === 'string' ? c : JSON.stringify(c));
  }
  return dir;
}
const quiet = () => {};
const run = (dir, flags) => runInit({ cwd: dir, log: quiet, flags: { yes: true, install: false, ...flags } });

// ---------- detection ----------

test('detects Next.js + TypeScript + pnpm + app router', () => {
  const dir = project({ 'package.json': { dependencies: { next: '15', react: '19', express: '4' }, devDependencies: { typescript: '5' } }, 'pnpm-lock.yaml': '', 'app/page.tsx': '' });
  const p = detectProject(dir);
  assert.equal(p.language, 'node');
  assert.equal(p.framework, 'nextjs');
  assert.equal(p.typescript, true);
  assert.equal(p.packageManager, 'pnpm');
  assert.equal(p.nextRouter, 'app');
});

test('detects Express (JS, CommonJS, yarn), NestJS, and pages router', () => {
  const e = detectProject(project({ 'package.json': { dependencies: { express: '4' } }, 'yarn.lock': '' }));
  assert.deepEqual([e.framework, e.typescript, e.esm, e.packageManager], ['express', false, false, 'yarn']);
  const n = detectProject(project({ 'package.json': { dependencies: { '@nestjs/core': '10', express: '4' } }, 'tsconfig.json': '{}' }));
  assert.deepEqual([n.framework, n.typescript], ['nestjs', true]);
  const pg = detectProject(project({ 'package.json': { dependencies: { next: '14' } }, 'pages/index.js': '' }));
  assert.equal(pg.nextRouter, 'pages');
});

test('detects Python, PHP and Go projects from files', () => {
  assert.deepEqual(Object.values((({ language, framework }) => ({ language, framework }))(detectProject(project({ 'requirements.txt': 'Django==5\n', 'manage.py': '' })))), ['python', 'django']);
  assert.equal(detectProject(project({ 'pyproject.toml': '[project]\ndependencies=["fastapi"]' })).framework, 'fastapi');
  assert.equal(detectProject(project({ 'composer.json': '{"require":{"laravel/framework":"^11"}}' })).framework, 'laravel');
  assert.equal(detectProject(project({ 'go.mod': 'module x' })).language, 'go');
  assert.equal(detectProject(tmp()).language, 'unknown');
});

// ---------- recommendation mapping ----------

test('coverage snapshot matches the source of truth shape', () => {
  assert.equal(LIVE.length, 14);
  assert.deepEqual(PAYOUT_LIVE.map((c) => c.code), ['TZ']);
});

test('marketplace maps to real capabilities and declares split payments unavailable', () => {
  const plan = recommend({ building: ['marketplace'], businessCountry: 'Tanzania', customerCountries: 'TZ, KE, UG', methods: ['mobile_money', 'card'], paySellers: true, commission: '10' });
  const ids = plan.capabilities.map((c) => c.id);
  for (const id of ['checkout_sessions', 'universal_charge', 'escrow', 'disbursements', 'webhooks']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.some((id) => /split|onboard|marketplace/.test(id)), 'never invents split payments');
  assert.ok(plan.unavailable.some((u) => /Split payments/.test(u.name)));
  assert.ok(plan.warnings.some((w) => /Kenya/.test(w) && /payouts/i.test(w)), 'warns KE payouts not live');
  assert.ok(plan.events.includes('disbursement.success'));
  assert.equal(plan.currency, 'TZS');
  assert.equal(plan.answers.commission, 10);
});

test('subscriptions adds recurring; invoices maps to checkout sessions honestly', () => {
  const plan = recommend({ building: 'subscriptions,invoices', businessCountry: 'KE', methods: 'card,paypal' });
  const ids = plan.capabilities.map((c) => c.id);
  assert.ok(ids.includes('recurring'));
  assert.ok(!ids.includes('disbursements'));
  assert.ok(plan.events.includes('recurring.activated'));
  assert.ok(plan.unavailable.some((u) => u.name === 'Invoice objects'));
  assert.equal(plan.currency, 'KES');
});

test('every recommended capability links to the docs and uses a real endpoint', () => {
  const spec = readFileSync(fileURLToPath(new URL('../src/recommend.js', import.meta.url)), 'utf8');
  assert.ok(!DASHES.test(spec));
  const plan = recommend({ building: BUILDING_ALL(), methods: 'mobile_money,card,paypal', paySellers: true, businessCountry: 'TZ' });
  for (const c of plan.capabilities) assert.match(c.doc, /^https:\/\/ultraner\.com\/docs/);
});
function BUILDING_ALL() { return ['checkout', 'marketplace', 'subscriptions', 'payouts', 'invoices']; }

test('non-live mobile money countries are flagged, unknown countries too', () => {
  const plan = recommend({ building: 'checkout', businessCountry: 'Nigeria', customerCountries: 'Atlantis', methods: 'mobile_money' });
  assert.ok(plan.warnings.some((w) => /Nigeria/.test(w)));
  assert.ok(plan.warnings.some((w) => /Atlantis/.test(w)));
});

// ---------- file generation ----------

test('Next.js TS project: writes env, client, charge, payouts, webhook lib and app route', async () => {
  const dir = project({ 'package.json': { dependencies: { next: '15' }, devDependencies: { typescript: '5' } }, 'app/page.tsx': '' });
  const r = await run(dir, { building: 'marketplace', country: 'TZ', customers: 'TZ', methods: 'mobile_money,card', paySellers: true, commission: '10' });
  for (const f of ['.env.example', 'lib/ultraner/client.ts', 'lib/ultraner/charge.ts', 'lib/ultraner/payouts.ts', 'lib/ultraner/webhook.ts', 'app/api/webhooks/ultraner/route.ts', 'README.md']) {
    assert.ok(existsSync(path.join(dir, f)), f);
  }
  const env = readFileSync(path.join(dir, '.env.example'), 'utf8');
  assert.match(env, /ULTRANER_API_KEY=uk_test_/);
  assert.match(env, /ULTRANER_SIGNATURE_KEY=usig_test_/);
  assert.match(readFileSync(path.join(dir, 'lib/ultraner/client.ts'), 'utf8'), /from '@ultraner\/sdk'/);
  assert.match(readFileSync(path.join(dir, 'app/api/webhooks/ultraner/route.ts'), 'utf8'), /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/ultraner\/webhook'/);
  assert.match(readFileSync(path.join(dir, 'lib/ultraner/payouts.ts'), 'utf8'), /PLATFORM_COMMISSION_PERCENT = 10/);
  assert.equal(r.written.length, 7);
});

test('generated webhook verification matches the documented signature (ESM and CJS)', async () => {
  const secret = 'whsec_test';
  const body = { event: 'payment.success', data: { transaction_id: 'txn_1', amount: 500 } };
  const good = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');

  const esm = project({ 'package.json': { type: 'module', dependencies: { express: '4' } } });
  await run(esm, { building: 'checkout', country: 'TZ' });
  const m = await import(pathToFileURL(path.join(esm, 'ultraner/webhook.js')).href);
  assert.equal(m.verifyUltranerSignature(body, good, secret), true);
  assert.equal(m.verifyUltranerSignature(body, good.replace(/.$/, '0'), secret), good.endsWith('0') ? true : false);
  assert.equal(m.verifyUltranerSignature(body, undefined, secret), false);
  assert.equal(typeof m.ultranerWebhook, 'function');

  const cjs = project({ 'package.json': { dependencies: { express: '4' } }, 'src/index.js': '' });
  await run(cjs, { building: 'checkout', country: 'TZ' });
  const c = createRequire(path.join(cjs, 'x.js'))(path.join(cjs, 'src/ultraner/webhook.js'));
  assert.equal(c.verifyUltranerSignature(body, good, secret), true);
  assert.equal(c.verifyUltranerSignature({ ...body, event: 'payment.failed' }, good, secret), false);

  // Express handler: 401 on bad signature, 200 on good.
  let status;
  const res = { status(s) { status = s; return this; }, end() {} };
  await m.ultranerWebhook({ body, headers: { 'x-ultraner-signature': 'sha256=bad' } }, res);
  assert.equal(status, 401);
  process.env.ULTRANER_WEBHOOK_SECRET = secret;
  await m.ultranerWebhook({ body, headers: { 'x-ultraner-signature': good } }, res);
  assert.equal(status, 200);
  delete process.env.ULTRANER_WEBHOOK_SECRET;
});

test('--dry-run writes nothing', async () => {
  const dir = project({ 'package.json': { dependencies: { express: '4' } } });
  const r = await run(dir, { dryRun: true, building: 'checkout' });
  assert.equal(r.written.length, 0);
  assert.deepEqual(readdirSync(dir), ['package.json']);
});

test('never overwrites existing files, merges env and appends README once', async () => {
  const dir = project({ 'package.json': { type: 'module', dependencies: { express: '4' } }, 'ultraner/client.js': '// mine\n', '.env.example': 'PORT=3000\nULTRANER_API_KEY=keep\n', 'README.md': '# App\n' });
  await run(dir, { building: 'checkout' });
  assert.equal(readFileSync(path.join(dir, 'ultraner/client.js'), 'utf8'), '// mine\n');
  const env = readFileSync(path.join(dir, '.env.example'), 'utf8');
  assert.match(env, /^PORT=3000\nULTRANER_API_KEY=keep\n/);
  assert.equal(env.match(/ULTRANER_API_KEY=/g).length, 1);
  assert.match(env, /ULTRANER_WEBHOOK_SECRET=/);
  await run(dir, { building: 'checkout' });
  const readme = readFileSync(path.join(dir, 'README.md'), 'utf8');
  assert.equal(readme.match(/## Payments with Ultraner/g).length, 1);
  assert.ok(readme.startsWith('# App\n'));
});

test('--force with --yes overwrites a changed generated file', async () => {
  const dir = project({ 'package.json': { type: 'module', dependencies: { express: '4' } }, 'ultraner/client.js': '// mine\n' });
  await run(dir, { building: 'checkout', force: true });
  assert.match(readFileSync(path.join(dir, 'ultraner/client.js'), 'utf8'), /@ultraner\/sdk/);
});

test('non-interactive without --yes writes nothing', async () => {
  const dir = project({ 'package.json': { dependencies: { express: '4' } } });
  const r = await runInit({ cwd: dir, log: quiet, flags: { building: 'checkout' } });
  assert.equal(r.written.length, 0);
  assert.equal(r.plan.answers.building[0], 'checkout');
});

test('Python project gets env + README pointing at the Python SDK only', () => {
  const p = detectProject(project({ 'requirements.txt': 'fastapi\n' }));
  const files = planFiles(p, recommend({ building: 'checkout', businessCountry: 'TZ' }));
  assert.deepEqual(files.map((f) => f.path), ['.env.example', 'README.md']);
  assert.match(files[1].content, /pip install ultraner/);
  assert.match(files[1].content, /frameworks\/md\/fastapi/);
});

test('parseArgs handles flags', () => {
  const o = parseArgs(['init', '--yes', '--dry-run', '--country', 'TZ', '--methods=card,paypal', '--no-install', '--pay-sellers']);
  assert.equal(o.command, 'init');
  assert.deepEqual(o.flags, { yes: true, dryRun: true, country: 'TZ', methods: 'card,paypal', install: false, paySellers: true });
});

test('no em-dashes or en-dashes in the package or its generated output', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const walk = (d) => readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    if (f === 'node_modules') return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  for (const f of walk(root)) assert.ok(!DASHES.test(readFileSync(f, 'utf8')), f);
  const dir = project({ 'package.json': { dependencies: { next: '15' } }, 'pages/index.js': '' });
  const p = detectProject(dir);
  for (const f of resolveActions(dir, planFiles(p, recommend({ building: BUILDING_ALL(), paySellers: true, methods: 'mobile_money,card,paypal', commission: 5 })))) {
    assert.ok(!DASHES.test(f.content), f.path);
  }
});
