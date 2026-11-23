#!/usr/bin/env node
'use strict';
// AGS4 file -> one metadata document per sample + index.json (sample id, file, dataHash) ready for minting.
//   node tools/ags4-to-geonft.js examples/site-investigation.ags --out out/
const fs = require('fs');
const path = require('path');
const { fromAgs } = require('./lib/from-ags');
const { validate } = require('./lib/validate');

const [entrada, ...resto] = process.argv.slice(2);
if (!entrada) { console.error('usage: node tools/ags4-to-geonft.js <file.ags> [--out dir]'); process.exit(1); }
const out = resto[resto.indexOf('--out') + 1] && resto.includes('--out') ? resto[resto.indexOf('--out') + 1] : 'out';
const certs = fromAgs(fs.readFileSync(entrada, 'utf8'), entrada);
fs.mkdirSync(out, { recursive: true });
let erros = 0;
for (const c of certs) {
  const v = validate(c.metadata);
  if (!v.ok) { erros++; console.error(`${c.sampleId}: ${v.errors.join('; ')}`); }
  fs.writeFileSync(path.join(out, c.file), JSON.stringify(c.metadata, null, 2) + '\n');
  console.log(`${c.sampleId.padEnd(28)} ${c.metadata.geonft.tests.length} test(s)  ${c.dataHash}  ${c.file}`);
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(certs.map(({ sampleId, file, dataHash }) => ({ sampleId, file, dataHash })), null, 2) + '\n');
console.log(`\n${certs.length} certificate(s) in ${out}/ (index.json lists what to mint)${erros ? `, ${erros} with schema errors` : ''}`);
process.exit(erros ? 2 : 0);
