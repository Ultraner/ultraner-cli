#!/usr/bin/env node
import { main } from '../src/cli.js';

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error('ultraner needs Node.js 18 or newer.');
  process.exit(1);
}

main().then((code) => { process.exitCode = code; }, (err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});
