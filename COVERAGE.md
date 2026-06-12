# Coverage & verification evidence

This document records **what is proven**, **how it was proven**, and **the exact
scope boundary** of the WitSeal execution-receipts-for-Cloudflare-Workers demo.

## Claim

A Cloudflare Workers isolate can **produce a canonical WitSeal v0.2 execution
receipt in-isolate via WebCrypto**, and that receipt is accepted as **VALID** by
the **unmodified** Node `witseal verify` — with **no change** to the receipt
schema, the 17-field canon, the golden vector, or the v0.2 pre-image rule.

## What is covered

| Aspect | Status |
| --- | --- |
| Canonical bytes identical to reference canonicalizer | Yes — `canonicalize` reproduced verbatim (pure-JS, no Node deps) |
| v0.2 single pre-image rule (`signature=""` + `receipt_hash=<zeros>`) | Yes — same bytes feed both `receipt_hash` and the Ed25519 signature |
| SHA-256 primitive on WebCrypto | Yes — `crypto.subtle.digest("SHA-256", …)` |
| Ed25519 primitive on WebCrypto | Yes — `crypto.subtle.sign({name:"Ed25519"}, …)`, standard algorithm |
| Full 17-field receipt | Yes — verified field count = 17 |
| Accepted by unmodified Node `witseal verify` | **Yes — `VALID ✓ (receipt.v0.2)`, exit 0** |
| Receipt produced by the real Workers runtime (`wrangler dev` / workerd) | Yes — see "In-isolate evidence" |
| Negative controls (tamper detection) | Yes — tampering any witnessed field or the hash/signature → `INVALID` |
| Golden vector unchanged | Yes — still 1050 bytes, SHA-256 `8fc29592…ef1b` |
| Receipt schema / version unchanged | Yes — `witseal.receipt.v0.2`, no new version, no schema edit |
| **Real build provenance (L4) in the receipt** | **Yes — `git_commit` is the real source commit (≠ sentinel zeros); `artifact_digest` = sha256 of the built bundle; `attestation_digest` = sha256 of a DSSE in-toto attestation of that bundle; `build_id` = run id / `wrangler@<ver>`; `artifact_type` = existing `generic-binary`** |
| DSSE in-toto attestation of the bundle (Ed25519, offline) | Yes — `payloadType=application/vnd.in-toto+json`, SLSA-provenance predicate, signed over the DSSE `PAE`; independently verifies with `crypto.verify` |
| **Provenance loop is publicly closeable** | **Yes — `GET /attestation` serves the exact DSSE envelope (`sha256` == `attestation_digest`) and `GET /attestation/pubkey` serves the trusted builder key, so a third party closes the loop with the unmodified `witseal verify --check-provenance`** |

## Build provenance (L4)

The Worker carries its **real build provenance** in each receipt. The v0.2
receipt's build-provenance fields **already exist** (mandatory; present in the
golden with sentinel values). This work fills them with real values via a
generated module — it does **not** change the schema, the 17-field canon, or the
golden vector. `artifact_type` stays the existing `generic-binary` taxonomy
value (no new literal).

- `scripts/gen-provenance.mjs` (build-time, git context): `git_commit` =
  `GITHUB_SHA` / `git rev-parse HEAD`; builds the Worker bundle
  (`wrangler deploy --dry-run --outdir`) and sets `artifact_digest` =
  `sha256:` of the bundle; generates a **DSSE in-toto** attestation of the
  bundle, signed with Ed25519 over the DSSE `PAE`, and sets `attestation_digest`
  = `sha256:` of that attestation envelope; `build_id` = `GITHUB_RUN_ID` or
  `wrangler@<version>`. It writes `src/provenance.gen.ts`.
- `src/provenance.gen.ts` (GENERATED) exports a typed `BUILD_PROVENANCE` plus
  `BUILD_ATTESTATION` (the exact DSSE envelope bytes + builder public key). The
  DSSE statement carries **no** build-host paths, so the published envelope is
  reproducible and host-path-free.
- `src/index-receipt-factory.ts` reads `BUILD_PROVENANCE` instead of inline
  sentinels.
- `src/index.ts` **publishes** the attestation: `GET /attestation` returns the
  envelope verbatim and `GET /attestation/pubkey` returns the builder key.

The attestation is signed with a clearly-labelled DEV-ONLY key unless
`WITSEAL_ATTESTATION_SEED_HEX` is set in the build environment. Because the Worker
now serves both the envelope and the builder key, the build-provenance loop is
**closed publicly** — a third party re-checks it with the unmodified
`witseal verify --check-provenance --attestation <…> --builder-key <…>` (see the
README "Closing the provenance loop" section).

## What is NOT covered (scope boundary / honesty ceiling)

The Worker witnesses **one isolate-native action its own handler performs and
owns** — a deterministic SHA-256 digest over the request body. It does **not**
cover:

- other Worker traffic, or requests the handler did not itself process;
- the host runtime, the platform, or other isolates;
- sub-requests the handler did not itself issue;
- any out-of-band side effect (it does not, and cannot from inside the isolate,
  witness a spawned subprocess — that is the structural reason the CLI exec path
  does not run in a Worker).

The ceiling is the WitSeal-authored handler/tool. No broader attestation is
implied.

## How it was verified

### Node-harness evidence (the exact WebCrypto module, run under Node)

Node's `crypto.subtle` implements Ed25519 + SHA-256 with the same semantics as
the Workers isolate, so running the **unmodified** receipt module under Node is a
faithful stand-in for the in-isolate crypto path.

```
$ tsx harness/produce-receipt.ts /tmp/worker-receipt.json /tmp/worker-pubkey.hex
receipt written: /tmp/worker-receipt.json
public key hex : fd62f46e4e64333ef4c0693e9caf52a540cb21a3546547f016bcd0e990c91862
receipt_hash   : 6722b06b99d91e69610947f96306c623b24a7ac8dfe0c15667aa2f80323245a6
signature      : ed25519:MvhD494OC16/NbYKX7B+niVCwcfSyaWRIbUORB3ROQ/23t8kNGSSg8SoW7ULUcg6HZzFmXykeEd2aMT58cNNCA==

$ node <witseal>/dist/src/cli/index.js verify /tmp/worker-receipt.json \
      --public-key fd62f46e4e64333ef4c0693e9caf52a540cb21a3546547f016bcd0e990c91862
witseal: VALID ✓ (receipt.v0.2)
         file:    /tmp/worker-receipt.json
exit=0
```

### Build-provenance live-verify (L4) — real (non-sentinel) provenance

`scripts/gen-provenance.mjs` was run in a git context: it built the Worker
bundle, hashed it, generated + signed a DSSE in-toto attestation, and wrote
`src/provenance.gen.ts` with **real** values. A receipt produced from those
values verifies under the **unmodified** `witseal verify`.

```
$ node scripts/gen-provenance.mjs
attestation written: …/provenance.intoto.dsse.json
provenance written: …/src/provenance.gen.ts
  gitCommit         : 5df00d56cb1b0d2f8c2aaff8e5bbb8820a811f3c
  artifactDigest    : sha256:f5c60abaad411ac060fd456d304f12254f390c46535c02101d09908fac03e6c5
  attestationDigest : sha256:0acbebb434e72f4fe292b8b905e30d6ac69d25b919d83de40bfe6ebbfd9a47f6
  buildId           : wrangler@4.98.0
  artifactType      : generic-binary

$ tsx harness/produce-receipt-provenance.ts /tmp/worker-receipt-provenance.json /tmp/worker-pubkey.hex
git_commit        : 5df00d56cb1b0d2f8c2aaff8e5bbb8820a811f3c   # ≠ sentinel zeros
artifact_digest   : sha256:f5c60abaad411ac060fd456d304f12254f390c46535c02101d09908fac03e6c5
attestation_digest: sha256:0acbebb434e72f4fe292b8b905e30d6ac69d25b919d83de40bfe6ebbfd9a47f6
build_id          : wrangler@4.98.0
artifact_type     : generic-binary

$ node <witseal>/dist/src/cli/index.js verify /tmp/worker-receipt-provenance.json \
      --public-key fd62f46e4e64333ef4c0693e9caf52a540cb21a3546547f016bcd0e990c91862
witseal: VALID ✓ (receipt.v0.2)
         file:    /tmp/worker-receipt-provenance.json
exit=0
```

Provenance is **bound** (not vacuous): flipping `git_commit` to a different valid
40-hex value makes the verifier reject the receipt —

```
witseal: INVALID ✗ (receipt.v0.2)
         reason: ed25519 signature verification failed
exit=1
```

The DSSE in-toto attestation is itself well-formed and verifies offline:

```
bundle sha256       : f5c60aba…fac03e6c5
statement subject   : sha256:f5c60aba…fac03e6c5
subject == bundle   : true
DSSE PAE sig VERIFY : VALID (Ed25519 over PAE)
```

### In-isolate evidence (real Workers runtime via `wrangler dev` / workerd)

The same module, served by the actual Workers runtime, produced a receipt over a
POST body; the unmodified Node verifier accepted it.

```
$ npx wrangler dev --port 8799
[wrangler:info] Ready on http://127.0.0.1:8799

$ curl -s http://127.0.0.1:8799/pubkey
fd62f46e4e64333ef4c0693e9caf52a540cb21a3546547f016bcd0e990c91862

$ printf 'hello-from-workerd-isolate' | curl -s -X POST \
      http://127.0.0.1:8799/receipt --data-binary @- > isolate-receipt.json
# 17-field receipt; execution_result_hash binds the digest of THIS payload

$ node <witseal>/dist/src/cli/index.js verify isolate-receipt.json \
      --public-key fd62f46e4e64333ef4c0693e9caf52a540cb21a3546547f016bcd0e990c91862
witseal: VALID ✓ (receipt.v0.2)
exit=0
```

### Negative controls

```
# Flip one hex char of receipt_hash:
witseal: INVALID ✗ (receipt.v0.2)
         reason: receipt_hash mismatch (self-hash check failed)
exit=1

# Tamper a witnessed field (build_id):
witseal: INVALID ✗ (receipt.v0.2)
         reason: ed25519 signature verification failed
exit=1

# Tamper the signature:
witseal: INVALID ✗ (receipt.v0.2)
         reason: ed25519 signature verification failed
exit=1
```

Tamper-detection on a witnessed field proves the signature actually **binds** the
receipt contents — the VALID result is not vacuous.

### Golden vector unchanged

```
$ shasum -a 256 <witseal>/tests/fixtures/golden-receipt/rust-golden.canonical
8fc29592fd3317e48caccc9b5c64d01cfa32d5e27846c50f233829e1bb17ef1b  rust-golden.canonical
$ wc -c < <witseal>/tests/fixtures/golden-receipt/rust-golden.canonical
1050
```

The canonical golden receipt remains 1050 bytes with the same SHA-256. This work
fills the build-provenance field VALUES from real build context; it does **not**
touch the schema or the golden vector.

## Notes

- Public key passed to the verifier is the raw 32-byte Ed25519 public key as
  64-char hex (`fd62f46e…91862`), derived in-isolate from the seed and served at
  `GET /pubkey`.
- The Worker source (`src/**`, incl. `provenance.gen.ts` + `index-receipt-factory.ts`)
  is type-clean under `@cloudflare/workers-types` (`tsc --noEmit`, no errors).
- The signing seed in the demo is the WitSeal repo **TEST-ONLY** fixture seed;
  production uses a Workers secret (`WITSEAL_SIGNING_SEED_HEX`). The DSSE build
  attestation uses a separate **DEV-ONLY** key unless
  `WITSEAL_ATTESTATION_SEED_HEX` is set.
