// Regenerates src/coverage.json from the website's lib/pay-countries.ts (the
// payment source of truth). Run from the website repo: node sdks/ultraner-cli/scripts/sync-coverage.mjs
import { createJiti } from 'jiti';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const { PAY_COUNTRIES } = await jiti.import(path.join(root, 'lib/pay-countries.ts'));
const countries = Object.values(PAY_COUNTRIES).map((c) => ({
  code: c.code, name: c.name, currency: c.currency, phonePrefix: c.phonePrefix,
  live: !!c.live, disbursement: c.disbursement || null,
  mnos: c.mnos.map((m) => ({ id: m.id, label: m.label })),
}));
writeFileSync(path.join(here, '../src/coverage.json'),
  JSON.stringify({ source: 'lib/pay-countries.ts', generatedAt: new Date().toISOString().slice(0, 10), countries }, null, 2) + '\n');
console.log(`wrote ${countries.length} countries, ${countries.filter((c) => c.live).length} live`);
