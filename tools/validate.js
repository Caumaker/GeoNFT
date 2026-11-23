#!/usr/bin/env node
'use strict';
// Validates metadata documents against the GeoNFT schema and prints the hash each token would store.
const fs = require('fs');
const { validate } = require('./lib/validate');
const { dataHashOf } = require('./lib/canonical');

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node tools/validate.js <metadata.json> [...]'); process.exit(1); }
let ruins = 0;
for (const f of files) {
  const md = JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = validate(md);
  if (!v.ok) ruins++;
  console.log(`${v.ok ? 'OK     ' : 'INVALID'} ${f}  ${v.ok ? dataHashOf(md) : v.errors.join('; ')}`);
}
process.exit(ruins ? 2 : 0);
