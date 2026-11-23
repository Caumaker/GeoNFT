#!/usr/bin/env node
'use strict';
// SHA-256 of files (lab reports, photos, logs) as "files" entries to paste into a metadata document.
const fs = require('fs');
const path = require('path');
const { sha256Hex } = require('./lib/canonical');

const TIPOS = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.ags': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node tools/hash.js <file> [...]'); process.exit(1); }
console.log(JSON.stringify(files.map((f) => ({ name: path.basename(f), sha256: sha256Hex(fs.readFileSync(f)), mediaType: TIPOS[path.extname(f).toLowerCase()] || 'application/octet-stream' })), null, 2));
