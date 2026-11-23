'use strict';
// Checks a token against a metadata document: same hash, not revoked, and the revision history.
const { dataHashOf } = require('./canonical');

const MAX_HISTORY = 5000; // revisions read one by one; a longer history is reported, not loaded

const ABI = [
  'function certificate(uint256) view returns (tuple(string sampleId, address issuer, uint64 issuedAt, bool revoked, string revokedReason), tuple(bytes32 dataHash, string uri, uint64 timestamp, address by, string reason), uint256)',
  'function revisionAt(uint256, uint256) view returns (tuple(bytes32 dataHash, string uri, uint64 timestamp, address by, string reason))',
  'function ownerOf(uint256) view returns (address)',
  'function hasRole(bytes32, address) view returns (bool)',
  'function ISSUER_ROLE() view returns (bytes32)',
];

async function verifyToken({ ethers, provider, address, tokenId, metadata, fetchMetadata }) {
  const c = new ethers.Contract(address, ABI, provider);
  const [cert, current, count] = await c.certificate(tokenId);
  const revs = [];
  for (let i = 0n; i < count && i < BigInt(MAX_HISTORY); i++) revs.push(await c.revisionAt(tokenId, i));
  const owner = await c.ownerOf(tokenId);
  const issuerStillAccredited = await c.hasRole(await c.ISSUER_ROLE(), cert.issuer);
  const doc = metadata || (fetchMetadata ? await fetchMetadata(current.uri) : null);
  const hash = doc ? dataHashOf(doc) : null;
  const atRevision = hash ? revs.findIndex((r) => r.dataHash === hash) : -1;
  const problems = [];
  if (!doc) problems.push('no metadata document to compare');
  else if (hash !== current.dataHash) problems.push(atRevision >= 0 ? `the document matches revision ${atRevision}, not the current one (${revs.length - 1})` : 'the document does not match any revision of this token');
  if (doc && doc.geonft && doc.geonft.sample && doc.geonft.sample.id !== cert.sampleId) problems.push(`the document describes sample ${doc.geonft.sample.id}, the token certifies ${cert.sampleId}`);
  if (cert.revoked) problems.push(`certificate revoked: ${cert.revokedReason}`);
  const notes = [];
  if (!issuerStillAccredited) notes.push('the issuer is no longer accredited; the certificate was valid when issued, check the accreditation history if it matters');
  if (count > BigInt(MAX_HISTORY)) notes.push(`history has ${count} revisions, only the first ${MAX_HISTORY} were read`);
  return {
    ok: problems.length === 0,
    problems,
    notes,
    sampleId: cert.sampleId,
    issuer: cert.issuer,
    issuerStillAccredited,
    owner,
    current: { dataHash: current.dataHash, uri: current.uri },
    computedHash: hash,
    history: revs.map((r, i) => ({ revision: i, at: new Date(Number(r.timestamp) * 1000).toISOString(), by: r.by, reason: r.reason, dataHash: r.dataHash, uri: r.uri })),
  };
}

module.exports = { verifyToken, ABI };
