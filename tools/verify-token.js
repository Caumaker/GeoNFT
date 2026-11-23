#!/usr/bin/env node
'use strict';
// Independent check of a certificate: reads the token from the chain and compares it with the metadata document.
//   node tools/verify-token.js --rpc https://polygon-rpc.com --contract 0x... --token 12 [--metadata file.json]
// Without --metadata it downloads the document from the token URI (ipfs:// goes through a public gateway).
const fs = require('fs');
const { ethers } = require('ethers');
const { verifyToken } = require('./lib/verify');

const a = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) a[process.argv[i].slice(2)] = process.argv[++i];
if (!a.rpc || !a.contract || !a.token) { console.error('usage: --rpc <url> --contract <address> --token <id> [--metadata file.json] [--ipfs-gateway https://ipfs.io/ipfs/]'); process.exit(1); }

async function fetchMetadata(uri) {
  const url = uri.startsWith('ipfs://') ? (a['ipfs-gateway'] || 'https://ipfs.io/ipfs/') + uri.slice(7) : uri;
  if (!/^https?:\/\//.test(url)) throw new Error(`cannot fetch ${uri}: pass --metadata`);
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

(async () => {
  const r = await verifyToken({
    ethers, provider: new ethers.JsonRpcProvider(a.rpc), address: a.contract, tokenId: BigInt(a.token),
    metadata: a.metadata ? JSON.parse(fs.readFileSync(a.metadata, 'utf8')) : null, fetchMetadata,
  });
  console.log(`${r.ok ? 'VALID  ' : 'INVALID'} token ${a.token}, sample ${r.sampleId}`);
  for (const p of r.problems) console.log('  - ' + p);
  console.log(`  issuer ${r.issuer}${r.issuerStillAccredited ? '' : ' (no longer accredited)'}, holder ${r.owner}`);
  for (const h of r.history) console.log(`  rev ${h.revision} ${h.at} ${h.reason} ${h.dataHash.slice(0, 18)}...`);
  process.exit(r.ok ? 0 : 2);
})().catch((e) => { console.error('error: ' + e.message); process.exit(1); });
