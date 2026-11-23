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

Requires Node.js 18 or newer. Nothing is deployed and no wallet is needed.

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
BH-01/2.00/1/U/BH01-U1       2 test(s)  0xdc58859e...  BH-01_2.00_1_U_BH01-U1.json
BH-01/6.00/2/D/BH01-D2       0 test(s)  0xa41bc1e0...  BH-01_6.00_2_D_BH01-D2.json
BH-02/3.00/1/U/BH02-U1       1 test(s)  0x53d6e25c...  BH-02_3.00_1_U_BH02-U1.json
BH-02/18.50/2/C/BH02-C2      1 test(s)  0xd0901357...  BH-02_18.50_2_C_BH02-C2.json
```

Each line is one sample, the number of tests linked to it, the hash its token will store, and its metadata file. `out/index.json` lists them for minting.

## The metadata document

The full rules are in [`schema/geonft-metadata.schema.json`](schema/geonft-metadata.schema.json) (JSON Schema). It is regular ERC-721 metadata, so wallets and explorers show the name and attributes, plus a `geonft` section:

```json
{
  "name": "BH-01 Undisturbed sample 2.00-2.45 m",
  "description": "Stiff reddish brown silty CLAY (residual soil). Example embankment foundation investigation",
  "attributes": [{ "trait_type": "Location", "value": "BH-01" }, { "trait_type": "Top (m)", "value": 2, "display_type": "number" }],
  "geonft": {
    "version": "1.0",
    "sample": { "id": "BH-01/2.00/1/U/BH01-U1", "locationId": "BH-01", "type": "U", "typeName": "Undisturbed",
                "top": 2, "base": 2.45, "depthUnit": "m", "collectedAt": "2026-03-10T09:15" },
    "location": { "type": "Feature",
                  "geometry": { "type": "Point", "coordinates": [-43.9234, -20.2145, 812.4] },
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

- `location` is a GeoJSON Feature (RFC 7946: longitude, latitude, elevation in WGS 84). When only projected coordinates are known, `geometry` is `null` and the projected values stay in `properties.projected`.
- `tests` keeps the AGS4 group code and heading names, with units, so nothing is lost in translation and the original file can be traced through `source`.
- `files` holds SHA-256 hashes of the documents behind the sample. `npm run hash -- report.pdf photo.jpg` prints these entries ready to paste.

**The hash.** The token stores `sha256(canonical JSON)`: the document serialized with object keys sorted at every level and no spaces. Formatting and key order do not change it, content does. The rule takes a few lines in any language (see `tools/lib/canonical.js`).

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

`tokenURI` always points to the current revision. The admin should be a multisig wallet of the body that accredits labs. The admin can accredit issuers and revoke certificates, but cannot rewrite any record.

## Checking a certificate

```bash
npm run verify-token -- --rpc https://polygon-rpc.com --contract 0x... --token 12
npm run verify-token -- --rpc https://polygon-rpc.com --contract 0x... --token 12 --metadata received.json
```

The verifier reads the token from the chain, fetches the document from its URI (or uses the file you give it), recomputes the hash and prints `VALID` or `INVALID`. It explains why: the document matches no revision, it matches an older revision, or the certificate was revoked. It also prints the full revision history, the issuer, whether the issuer is still accredited, and the current holder.

## Publishing on Polygon

The contract is ready for Polygon PoS, where transactions are cheap. Nothing here is deployed for you: deploying needs a wallet you control.

1. Create a wallet just for deploying and fund it: test POL from a faucet for the Amoy testnet, or real POL for mainnet.
2. Deploy, keeping the key out of every file:
   ```bash
   export DEPLOYER_KEY=0x...            # the deploying wallet's private key
   npx hardhat run scripts/deploy.js --network amoy
   ```
   The address is saved in `deployments/amoy.json`. Use `--network polygon` for mainnet. `AMOY_RPC_URL` and `POLYGON_RPC_URL` override the public RPC endpoints.
3. Publish the metadata folder where it will stay reachable (IPFS with pinning, Arweave, or your own HTTPS server), then mint:
   ```bash
   CONTRACT=0x... BASE_URI=ipfs://<folder CID>/ INDEX=out/index.json npx hardhat run scripts/mint.js --network amoy
   ```
4. Optionally publish the source on Polygonscan: `npx hardhat verify --network amoy <address> <admin address>` with `POLYGONSCAN_API_KEY` set.

## Development

```bash
npm test         # contract tests (Hardhat), verification against documents, and the AGS4/metadata tools (node:test)
npm run demo
```

```
contracts/GeoNFT.sol         the certificate contract
schema/                      metadata JSON Schema
tools/lib/                   canonical hash, AGS4 reader, AGS4 -> metadata, validator, token verifier
tools/*.js                   command line: from-ags, validate, hash, verify-token
scripts/                     deploy, mint, demo (Hardhat)
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
