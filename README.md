# GeoNFT

**Digital certificates for geological samples and data.**

![tests](https://github.com/Caumaker/GeoNFT/actions/workflows/ci.yml/badge.svg)

A drill core, a soil sample or a rock specimen is worth only as much as its records: where it came from, at what depth, who collected it, what the lab found, and who held it since. Those records live in spreadsheets, PDFs and AGS files that are copied, edited and re-sent many times. When a dam design, a mining resource estimate or a court case depends on a result, people need to know whether the document in front of them is the one the lab issued.

GeoNFT turns each sample into an ERC-721 token issued by an accredited lab or company. The token does not hold the data. It holds the **SHA-256 of the sample's metadata document**, and that document is an open, readable JSON file with the location as GeoJSON, the depth interval, the tests and the hashes of the files behind it (lab reports, photos, logs). Anyone can recompute the hash of the document they received and compare it with the token. A single changed number does not match.

- **Corrections never erase anything.** A new lab result or a fixed coordinate becomes a new revision. The earlier ones stay readable, with who wrote them, when and why.
- **Withdrawn is not deleted.** A contaminated sample is revoked with a reason, and the token and its history remain.
- **Chain of custody.** The token travels with the physical sample: site store, lab, second lab, archive. Each hand-over is a transfer that can carry a note ("core box 7 shipped, seal 4471").
- **Built from the data you already have.** A converter reads AGS4, the standard exchange format for geotechnical and geoenvironmental data, and writes one certificate per sample with its location, project and tests.

## Quick start

Requires Node.js 20 or newer. Nothing is deployed and no wallet is needed.

```bash
git clone https://github.com/Caumaker/GeoNFT.git
cd GeoNFT
npm install
npm test
npm run demo
```

`npm run demo` runs the whole life of a certificate on a local chain: it issues the four samples of `examples/site-investigation.ags`, catches an edited moisture content, adds a lab report as a new revision, sends a core box to another lab and back with custody notes, and revokes a contaminated sample.

Turn an AGS4 file into certificates:

```bash
npm run from-ags -- examples/site-investigation.ags --out out/
```

```
BH-01/2/1/U/BH01-U1        2 test(s)  0x...  BH-01_2_1_U_BH01-U1.json
BH-01/6/2/D/BH01-D2        0 test(s)  0x...  BH-01_6_2_D_BH01-D2.json
BH-02/3/1/U/BH02-U1        1 test(s)  0x...  BH-02_3_1_U_BH02-U1.json
BH-02/18.5/2/C/BH02-C2     1 test(s)  0x...  BH-02_18.5_2_C_BH02-C2.json
```

Each line is one sample, the number of tests linked to it, its hash and its metadata file. `out/index.json` lists them for minting. The converter is strict on purpose, because a certificate attached to the wrong sample is worse than none:

- The **sample id** is `LOCA_ID/SAMP_TOP/SAMP_REF/SAMP_TYPE/SAMP_ID`, with the depth written as a plain number, so `2`, `2.0` and `2,00` are the same sample. A `/` inside a field is escaped as `%2F`.
- A test row goes to the sample whose location, depth and filled key fields all match. Without a depth, only a matching `SAMP_ID` counts. If a row fits **two** samples, the conversion stops and asks you to fill the missing keys. A row that fits **no** sample is reported as a warning and left out.
- Duplicate samples, repeated groups, two samples that would get the same file name, and files that are not UTF-8 stop the conversion before anything is written. The source hash is taken over the file's bytes.
- Latitude and longitude become GeoJSON only when the datum (`LOCA_LLZ`) is WGS 84 or compatible (SIRGAS 2000, ETRS89, NAD83, ITRF). Otherwise they are kept in `properties.geographic` with their datum. Values that are not decimal degrees or are out of range are reported. The ground level stays in `properties.groundLevel`: it is a local height, not a WGS 84 one.

## The metadata document

The full rules are in [`schema/geonft-metadata.schema.json`](schema/geonft-metadata.schema.json) (JSON Schema). It is regular ERC-721 metadata, so wallets and explorers show the name and attributes, plus a `geonft` section:

```json
{
  "name": "BH-01 Undisturbed sample 2.00-2.45 m",
  "description": "Stiff reddish brown silty CLAY (residual soil). Example embankment foundation investigation",
  "attributes": [{ "trait_type": "Location", "value": "BH-01" }, { "trait_type": "Top (m)", "value": 2, "display_type": "number" }],
  "geonft": {
    "version": "1.0",
    "sample": { "id": "BH-01/2/1/U/BH01-U1", "locationId": "BH-01", "type": "U", "typeName": "Undisturbed",
                "top": 2, "base": 2.45, "depthUnit": "m", "collectedAt": "2026-03-10T09:15" },
    "location": { "type": "Feature",
                  "geometry": { "type": "Point", "coordinates": [-43.9234, -20.2145] },
                  "properties": { "id": "BH-01", "groundLevel": 812.4,
                                  "projected": { "easting": 612345.1, "northing": 7765432.2, "system": "SIRGAS 2000 / UTM zone 23S" } } },
    "project": { "id": "EX-2026-01", "name": "Example embankment foundation investigation" },
    "tests": [{ "group": "LLPL", "name": "Atterberg limits",
                "results": { "LLPL_LL": { "value": 52, "unit": "%" }, "LLPL_PL": { "value": 31, "unit": "%" } } }],
    "files": [{ "name": "BH01-U1-lab-report.pdf", "sha256": "3f0c...", "mediaType": "application/pdf", "uri": "ipfs://..." }],
    "source": { "format": "AGS4", "file": "site-investigation.ags", "sha256": "..." }
  }
}
```

- `location` is a GeoJSON Feature (RFC 7946: longitude and latitude in WGS 84). When only projected coordinates, or coordinates in another datum, are known, `geometry` is `null` and the values stay in `properties.projected` or `properties.geographic`.
- `tests` keeps the AGS4 group code and heading names, with units, so nothing is lost in translation and the original file can be traced through `source`.
- `files` holds SHA-256 hashes of the documents behind the sample. `npm run hash -- report.pdf photo.jpg` prints these entries ready to paste.

**The hash.** The token stores the SHA-256 of the document in the JSON Canonicalization Scheme, [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785): keys sorted by UTF-16 code units at every level, no spaces, numbers as JavaScript prints them, non-ASCII text kept as UTF-8. Formatting and key order do not change the hash, content does. In JavaScript it is `tools/lib/canonical.js`; in other languages use a JCS library (a plain "sort keys" serializer differs on non-ASCII text such as "São João"). Text is hashed exactly as written: the same word in a different Unicode normalization (NFC vs NFD) is a different document.

Documents read by the tools go through a strict parser that refuses duplicate keys (`{"v":28,"v":18}` would show one value and hash another) and integers too large to round-trip (write those as strings).

## The contract

`contracts/GeoNFT.sol` is ERC-721 (OpenZeppelin 5) with role-based access:

| Function | Who | What it does |
|---|---|---|
| `issue(to, sampleId, dataHash, uri)` | accredited issuer (`ISSUER_ROLE`) | Creates the certificate and gives it to the first custodian. One certificate per sample id per issuer. |
| `revise(tokenId, dataHash, uri, reason)` | the issuer that issued it, while still accredited | Adds a revision. Emits `Revised` and ERC-4906 `MetadataUpdate`. |
| `revoke(tokenId, reason)` | that issuer, or the admin | Marks the certificate as withdrawn, with the reason. No more revisions. |
| `transferWithNote(to, tokenId, note)` | holder or approved operator | Normal transfer plus a `CustodyNote` event. Plain ERC-721 transfers also work. |
| `certificate(tokenId)`, `revisions(tokenId)`, `dataHash(tokenId)`, `tokenURI(tokenId)` | anyone | Current state and the full history. |
| `grantRole` / `revokeRole` | admin (`DEFAULT_ADMIN_ROLE`) | Accredits or removes issuers. |

`tokenURI` always points to the current revision. An issuer whose accreditation is removed can no longer revise or revoke its certificates, so a stolen key that was de-accredited cannot wipe records. The admin should be a multisig wallet of the body that accredits labs: it can accredit issuers and revoke certificates, but cannot rewrite any record. `revisionCount` and `revisionAt` read long histories one revision at a time. `Issued` and `CustodyNote` are emitted before the token moves, so indexers see the history in order even when the receiver is a contract that reacts to the transfer.

## Checking a certificate

```bash
npm run verify-token -- --rpc https://polygon-rpc.com --contract 0x... --token 12
npm run verify-token -- --rpc https://polygon-rpc.com --contract 0x... --token 12 --metadata received.json
```

The verifier reads the token from the chain, fetches the document from its URI (or uses the file you give it), recomputes the hash and prints `VALID` or `INVALID`. It explains why: the document matches no revision, it matches an older revision, it describes another sample, or the certificate was revoked. It also prints the full revision history, the issuer, whether the issuer is still accredited (a note, not a failure: the certificate was valid when issued), and the current holder.

## Publishing on Polygon

The contract is ready for Polygon PoS, where transactions are cheap. Nothing here is deployed for you: deploying needs a wallet you control.

1. Create a wallet just for deploying and fund it: test POL from a faucet for the Amoy testnet, or real POL for mainnet.
2. Deploy, keeping the key out of every file, with a multisig (for example a Safe) as admin:
   ```bash
   export DEPLOYER_KEY=0x...            # the deploying wallet's private key
   ADMIN=0x<multisig> npx hardhat run scripts/deploy.js --network amoy
   ```
   With `ADMIN` the deploying key ends with no role; the multisig then accredits each lab with `grantRole(ISSUER_ROLE, lab)`. Without `ADMIN` the deployer becomes admin and first issuer, which is fine for a test. The address is saved in `deployments/amoy.json`. Use `--network polygon` for mainnet. `AMOY_RPC_URL` and `POLYGON_RPC_URL` override the public RPC endpoints.
3. Edit the documents in `out/` if needed (for example add lab reports with `npm run hash -- report.pdf`), publish the folder where it will stay reachable (IPFS with pinning, Arweave, or your own HTTPS server), then mint with the issuer's key:
   ```bash
   CONTRACT=0x... BASE_URI=ipfs://<folder CID>/ OUT=out CHECK_URI=1 npx hardhat run scripts/mint.js --network amoy
   ```
   The hash is computed from each file at minting time and the document must pass the schema. `CHECK_URI=1` downloads each published document and refuses to mint if it differs from the local file. Running it again skips what is already issued with the same document, and stops if a sample was issued with a different one.
4. To record a correction, publish the new document under a new address and run:
   ```bash
   CONTRACT=0x... TOKEN=12 FILE=out/<file>.json URI=ipfs://<new CID>/<file>.json REASON="lab report added" npx hardhat run scripts/revise.js --network amoy
   ```
5. Optionally publish the source on Polygonscan: `npx hardhat verify --network amoy <address> <admin address>` with `POLYGONSCAN_API_KEY` set.

## Development

```bash
npm test         # contract tests (Hardhat), verification against documents, and the AGS4/metadata tools (node:test)
npm run demo
```

```
contracts/GeoNFT.sol         the certificate contract
schema/                      metadata JSON Schema
tools/lib/                   canonical hash (JCS), strict JSON, AGS4 reader, AGS4 -> metadata, validator, token verifier
tools/*.js                   command line: from-ags, validate, hash, verify-token
scripts/                     deploy, mint, revise, demo (Hardhat)
examples/                    an illustrative AGS4 site investigation
test/, tools/test/           tests
```

## Roadmap

- Batch issuing with a Merkle root per delivery, so thousands of samples cost one transaction.
- Signed metadata (EIP-712) so a document can be checked offline against the issuer's key.
- Import from more formats (Brazilian lab spreadsheets, DIGGS, borehole logs).
- Anchoring of readings from [Contrust](https://github.com/Caumaker/Contrust) in the same certificate history.

## Authors

Created by **Cauê Somensi**, designed and written with **Claude** (Anthropic).

## License

MIT. See [LICENSE](LICENSE).

---

## Em português

O GeoNFT transforma cada amostra geológica (testemunho de sondagem, amostra de solo, corpo de prova) num certificado digital ERC-721 emitido por um laboratório credenciado. O token guarda o hash SHA-256 de um documento aberto com a localização em GeoJSON, a profundidade, os ensaios e os hashes dos laudos. Qualquer pessoa confere se o documento que recebeu é o certificado. Correções viram revisões, nada é apagado; amostra contaminada é revogada com o motivo; cada troca de mãos fica registrada com nota de custódia. Um conversor lê AGS4 e gera um certificado por amostra. O contrato está pronto para a rede Polygon, com testes e demonstração local, e a publicação é feita com uma carteira sua.
