import { createInterface } from 'node:readline/promises';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { detectProject, describeProject } from './detect.js';
import { recommend, formatPlan, BUILDING, LIVE } from './recommend.js';
import { planFiles, resolveActions, installCommand } from './generate.js';

const VERSION = '0.1.0';

const HELP = `Usage: npx ultraner init [options]

Detects your project, asks what you are building, recommends an Ultraner
integration and (with your consent) scaffolds it.

Options:
  --yes, -y               Accept defaults and say yes to every prompt (still never overwrites existing files)
  --dry-run               Show the plan and the files, write nothing, install nothing
  --force                 Allow overwriting existing generated files (asks first unless --yes)
  --no-install            Never install @ultraner/sdk
  --cwd <dir>             Project directory (default: current directory)
  --building <list>       checkout,marketplace,subscriptions,payouts,invoices
  --country <name|code>   Business country, e.g. Tanzania or TZ
  --customers <list>      Customer countries, e.g. TZ,KE,UG
  --methods <list>        mobile_money,card,paypal
  --pay-sellers           You pay sellers or other people out
  --commission <percent>  Platform commission you keep, e.g. 10
  --help, -h              Show this help
  --version, -v           Show the version
`;

export function parseArgs(argv) {
  const opts = { command: null, flags: {} };
  const valued = new Set(['cwd', 'building', 'country', 'customers', 'methods', 'commission']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-y') opts.flags.yes = true;
    else if (arg === '-h') opts.flags.help = true;
    else if (arg === '-v') opts.flags.version = true;
    else if (arg.startsWith('--')) {
      let [key, val] = arg.slice(2).split(/=(.*)/s);
      if (valued.has(key) && val === undefined) val = argv[++i];
      if (key === 'no-install') opts.flags.install = false;
      else opts.flags[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val === undefined ? true : val;
    } else if (!opts.command) opts.command = arg;
  }
  return opts;
}

/** Prompts that degrade safely: no TTY or --yes means "take the default". */
export function createPrompter({ input = process.stdin, output = process.stdout, auto = false } = {}) {
  const interactive = !auto && input.isTTY;
  let rl = null;
  const get = () => (rl ||= createInterface({ input, output }));
  return {
    interactive,
    async text(q, def = '') {
      if (!interactive) return def;
      const a = (await get().question(`${q}${def ? ` (${def})` : ''}: `)).trim();
      return a || def;
    },
    async confirm(q, def = false) {
      if (!interactive) return auto ? true : def;
      const a = (await get().question(`${q} ${def ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
      if (!a) return def;
      return a === 'y' || a === 'yes';
    },
    async choose(q, choices, { multi = false, def = [0] } = {}) {
      if (!interactive) return multi ? def.map((i) => choices[i].value) : choices[def[0]].value;
      output.write(`${q}\n`);
      choices.forEach((c, i) => output.write(`  ${i + 1}) ${c.label}\n`));
      const hint = multi ? 'numbers, comma separated' : 'number';
      for (;;) {
        const raw = (await get().question(`> (${hint}, default ${def.map((i) => i + 1).join(',')}): `)).trim();
        const picks = raw ? raw.split(/[\s,]+/).map((n) => Number(n) - 1) : def;
        if (picks.every((n) => Number.isInteger(n) && n >= 0 && n < choices.length) && (multi || picks.length === 1)) {
          return multi ? [...new Set(picks)].map((i) => choices[i].value) : choices[picks[0]].value;
        }
        output.write('Please pick from the list.\n');
      }
    },
    close() { rl?.close(); },
  };
}

async function questionnaire(p, flags) {
  const a = {};
  a.building = flags.building ?? await p.choose('What are you building?', [
    { label: 'Checkout (sell products or services)', value: 'checkout' },
    { label: 'Marketplace (buyers pay, you pay sellers)', value: 'marketplace' },
    { label: 'Subscriptions', value: 'subscriptions' },
    { label: 'Payouts (send money to people)', value: 'payouts' },
    { label: 'Invoices (bill customers)', value: 'invoices' },
  ], { multi: true, def: [0] });
  a.businessCountry = flags.country ?? await p.text('Where is your business registered? (country name or code)', 'Tanzania');
  a.customerCountries = flags.customers ?? await p.text(`Where are your customers? (comma separated; mobile money live in ${LIVE.map((c) => c.code).join(', ')})`, a.businessCountry);
  a.methods = flags.methods ?? await p.choose('How will customers pay?', [
    { label: 'Mobile money', value: 'mobile_money' },
    { label: 'Cards', value: 'card' },
    { label: 'PayPal', value: 'paypal' },
  ], { multi: true, def: [0, 1] });
  const list = Array.isArray(a.building) ? a.building : String(a.building).split(',');
  const sellerish = list.some((b) => b.trim() === 'marketplace' || b.trim() === 'payouts');
  if (flags.paySellers !== undefined) a.paySellers = flags.paySellers === true || flags.paySellers === 'true';
  else a.paySellers = sellerish ? await p.confirm('Do you need to pay sellers (or other people) out?', true) : false;
  if (flags.commission !== undefined) a.commission = flags.commission;
  else if (a.paySellers || list.some((b) => b.trim() === 'marketplace')) {
    const takes = await p.confirm('Do you keep a platform commission?', false);
    if (takes) a.commission = await p.text('Commission percent', '10');
  }
  return a;
}

export async function runInit({ flags = {}, cwd = process.cwd(), log = console.log, prompter } = {}) {
  const root = path.resolve(flags.cwd || cwd);
  const dryRun = !!flags.dryRun;
  const p = prompter || createPrompter({ auto: !!flags.yes });
  try {
    log('Ultraner init\n');
    const project = detectProject(root);
    for (const l of describeProject(project)) log(`  + ${l}`);
    log('');
    if (!p.interactive && !flags.yes) log('No interactive terminal: using flags and defaults.\n');

    const answers = await questionnaire(p, flags);
    log('\nAnalyzing your requirements...\n');
    const plan = recommend(answers);
    log(formatPlan(plan, project));
    log('');

    const actions = resolveActions(root, planFiles(project, plan));
    log('Files:');
    for (const f of actions) log(`  ${f.action.padEnd(9)} ${f.path}${f.reason ? ` (${f.reason})` : ''}`);
    log('');

    if (dryRun) {
      log('Dry run: nothing was written or installed.');
      return { project, plan, actions, written: [] };
    }

    const proceed = await p.confirm('Write these files?', false);
    if (!proceed) {
      log('Nothing written. Re-run with --yes to accept, or --dry-run to preview.');
      return { project, plan, actions, written: [] };
    }

    const written = [];
    for (const f of actions) {
      const abs = path.join(root, f.path);
      if (f.action === 'skip') continue;
      if (f.action === 'overwrite') {
        const ok = flags.force && (await p.confirm(`${f.path} exists. Overwrite it?`, false));
        if (!ok) { log(`  kept     ${f.path} (exists; use --force to replace)`); continue; }
      }
      mkdirSync(path.dirname(abs), { recursive: true });
      if (f.action === 'append') appendFileSync(abs, f.appendText);
      else writeFileSync(abs, f.content);
      written.push(f.path);
      log(`  wrote    ${f.path}`);
    }

    if (project.language === 'node' && !project.hasSdk && flags.install !== false) {
      const cmd = installCommand(project.packageManager);
      if (await p.confirm(`Install @ultraner/sdk now (${cmd})?`, false)) {
        const [bin, ...args] = cmd.split(' ');
        const r = spawnSync(bin, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
        log(r.status === 0 ? '  installed @ultraner/sdk' : `  install failed, run it yourself: ${cmd}`);
      } else {
        log(`  Install it later with: ${cmd}`);
      }
    }

    log('\nNext: put a uk_test_ key in your env, add the webhook in Console > Webhooks, and read https://ultraner.com/docs');
    return { project, plan, actions, written };
  } finally {
    if (!prompter) p.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command, flags } = parseArgs(argv);
  if (flags.version) { console.log(VERSION); return 0; }
  if (flags.help || !command) { console.log(HELP); return command || flags.help ? 0 : 1; }
  if (command !== 'init') { console.error(`Unknown command: ${command}\n\n${HELP}`); return 1; }
  if (flags.building && String(flags.building).split(',').some((b) => !BUILDING.includes(b.trim()))) {
    console.error(`--building takes: ${BUILDING.join(', ')}`); return 1;
  }
  await runInit({ flags });
  return 0;
}
