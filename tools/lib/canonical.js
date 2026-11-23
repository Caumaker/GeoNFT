'use strict';
// The hash every GeoNFT certificate commits to: SHA-256 of the metadata as canonical JSON (keys sorted at every
// level, no extra spaces). Anyone can recompute it from the document with a few lines in any language.
const crypto = require('crypto');

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).filter((k) => value[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
// bytes32 for the contract: 0x + 64 hex characters
const dataHashOf = (metadata) => '0x' + sha256Hex(canonical(metadata));

module.exports = { canonical, sha256Hex, dataHashOf };
