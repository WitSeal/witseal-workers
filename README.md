# witseal-workers

WitSeal **v0.2 execution receipts produced inside a Cloudflare Workers isolate**,
verifiable byte-for-byte by the unmodified Node `witseal` CLI.

## Why this exists

A Cloudflare Worker runs in a V8 isolate. There is **no** `child_process`, **no**
`fs`, **no** process spawning. The WitSeal CLI / mediated-execution path
(`witseal exec`, which spawns and witnesses a subprocess) therefore **cannot run
in-isolate**.

What a Worker *can* do is **produce a canonical WitSeal v0.2 execution receipt
in-isolate**, using WebCrypto (`crypto.subtle`), for an isolate-native action it
owns. This repo demonstrates exactly that, and proves the receipt is accepted as
**VALID** by the existing Node `witseal verify` — with **no change to the receipt
schema, the 17-field canon, the golden vector, or the v0.2 pre-image rule.**

## What is witnessed (scope / honesty ceiling)

The Worker witnesses **one isolate-native action that its own handler performs and
owns**: a deterministic SHA-256 digest computed over the request body
(`crypto.subtle.digest`). The receipt attests *that* action — its classified
intent, the handler's policy decision, and the execution result are all the
handler's own.

It does **not** witness:

- other Worker traffic or requests it did not handle,
- the host runtime or other isolates,
- sub-requests the handler did not itself issue.

The ceiling is the WitSeal-authored handler/tool. Nothing wider is claimed.

## How canon stays unchanged

This is **not** a schema change and **not** a new receipt version. Only the two
cryptographic **primitives** are re-implemented on WebCrypto, computed over
**byte-identical canonical bytes**:

- [`src/witseal-receipt.ts`](src/witseal-receipt.ts) reproduces the WitSeal
  RFC-8785-subset canonicalizer **verbatim** from the reference
  implementation's pure-JS canonicalizer (no Node dependencies), and reproduces
  the v0.2 **single pre-image** rule exactly:

  > pre-image `P` = the receipt body with `signature = ""` **and**
  > `receipt_hash = <64 hex zeros>`;
  > `preimageBytes = TextEncoder().encode(canonicalize(P))`;
  > the **same** bytes feed both `receipt_hash = hex(SHA-256(preimageBytes))`
  > and the Ed25519 `signature`.
  > The final wire `signature` carries the `ed25519:` prefix; the prefix is
  > **not** part of the signed bytes.

- The only difference from the Node helper is the crypto engine:
  `receipt_hash = hex(crypto.subtle.digest("SHA-256", preimageBytes))` and
  `signature = "ed25519:" + base64(crypto.subtle.sign({name:"Ed25519"}, key, preimageBytes))`.

Because the bytes and the procedure are identical, the receipt verifies under the
unchanged Node verifier.

## Routes

| Method | Path                 | Description                                                            |
| ------ | -------------------- | --------------------------------------------------------------------- |
| `GET`  | `/`                  | Service banner + usage.                                               |
| `GET`  | `/pubkey`            | The Ed25519 public key (hex) for `witseal verify --public-key`.        |
| `POST` | `/receipt`           | Perform the witnessed action over the POST body; return the signed receipt JSON. |
| `GET`  | `/attestation`       | The build's DSSE in-toto attestation, served verbatim; its `sha256` equals every receipt's `attestation_digest`. |
| `GET`  | `/attestation/pubkey`| The builder (attestation) public key (hex): the trusted `--builder-key` for `witseal verify --check-provenance`. |

## Run locally

```sh
npx wrangler dev
```

Then, in another shell:

```sh
# 1. Get the public key the isolate signs with.
PUB=$(curl -s http://127.0.0.1:8787/pubkey)

# 2. Ask the isolate to witness a SHA-256 over a payload and emit the receipt.
printf 'hello' | curl -s -X POST http://127.0.0.1:8787/receipt --data-binary @- > receipt.json

# 3. Verify with the UNMODIFIED Node witseal CLI (from your witseal checkout):
node /path/to/witseal/dist/src/cli/index.js verify receipt.json --public-key "$PUB"
# witseal: VALID ✓ (receipt.v0.2)
```

A node harness ([`harness/produce-receipt.ts`](harness/produce-receipt.ts))
runs the **exact same** WebCrypto receipt module outside the isolate — Node's
`crypto.subtle` implements Ed25519 + SHA-256 with the same semantics as the
Workers isolate, so it is a faithful stand-in for the in-isolate path:

```sh
npm run verify-demo   # writes /tmp/worker-receipt.json + /tmp/worker-pubkey.hex
```

## Build provenance (L4)

The Worker now carries its **real build provenance** in every receipt it emits.
The v0.2 receipt already has the build-provenance fields — `git_commit`,
`artifact_digest`, `attestation_digest`, `build_id`, `artifact_type` (they are
mandatory in v0.2 and present in the golden) — so this fills them with **real**
values instead of the inline sentinels the demo used to hard-code. **No schema,
canon, or golden change**: only the field *values* go from placeholders to real
build context, and `artifact_type` stays the existing `generic-binary` taxonomy
value.

| Receipt field        | Real value (L4)                                                    |
| -------------------- | ------------------------------------------------------------------ |
| `git_commit`         | `GITHUB_SHA` or `git rev-parse HEAD` — the real 40-hex source commit |
| `artifact_digest`    | `sha256:` of the built Worker bundle                               |
| `attestation_digest` | `sha256:` of a **DSSE in-toto** attestation of that bundle (Ed25519) |
| `build_id`           | `GITHUB_RUN_ID` in CI, else `wrangler@<version>` locally           |
| `artifact_type`      | `generic-binary` (existing taxonomy value)                         |

How it is wired:

- [`scripts/gen-provenance.mjs`](scripts/gen-provenance.mjs) runs at build time
  (in a git context). It resolves the git commit, builds the Worker bundle
  (`wrangler deploy --dry-run --outdir`), hashes it, generates and signs a
  **DSSE (in-toto / SLSA-provenance) attestation** of the bundle with Ed25519
  over the DSSE `PAE` pre-authentication encoding (the same algorithm family as
  `witseal sign-v0.2`), hashes that attestation, and writes
  [`src/provenance.gen.ts`](src/provenance.gen.ts).
- [`src/provenance.gen.ts`](src/provenance.gen.ts) is a **generated** module
  (committed with placeholder/dev values + a "GENERATED — do not edit" header)
  exporting a typed `BUILD_PROVENANCE` and `BUILD_ATTESTATION` (the exact DSSE
  envelope bytes + the builder public key).
- [`src/index-receipt-factory.ts`](src/index-receipt-factory.ts) reads
  `BUILD_PROVENANCE` from that module instead of inline sentinels.

```sh
npm run gen-provenance     # writes src/provenance.gen.ts from real build context
                           # (also runs automatically as the `deploy` predeploy step)
```

The DSSE attestation is signed with a clearly-labelled **DEV-ONLY** key unless
`WITSEAL_ATTESTATION_SEED_HEX` is set in the build environment (export it for the
real build — it is consumed at build time by `gen-provenance.mjs`, *not* a Worker
runtime secret).

### Closing the provenance loop (independent re-check)

The Worker **publishes** the exact DSSE attestation envelope at `GET /attestation`
and the builder public key at `GET /attestation/pubkey`, so any third party can
re-check the build provenance with the **unmodified** `witseal verify
--check-provenance` — no insider artifacts required:

```sh
BASE=https://receipts.witseal.com
curl -s "$BASE/pubkey"                 > pub.hex
curl -s "$BASE/attestation"            > attestation.json
curl -s "$BASE/attestation/pubkey"     > builder.hex
printf 'hello' | curl -s -X POST "$BASE/receipt" --data-binary @- > receipt.json

node /path/to/witseal/dist/src/cli/index.js verify receipt.json \
  --public-key "$(cat pub.hex)" \
  --check-provenance --attestation attestation.json --builder-key "$(cat builder.hex)"
# witseal: VALID ✓ (receipt.v0.2)
# provenance: VALID (artifact ↔ attestation bound)
```

The served envelope is byte-identical to the bytes whose `sha256` is each
receipt's `attestation_digest`, so `verify` pins the receipt to *this* exact
attestation (any single-byte change → `attestation_digest mismatch`), then checks
the DSSE Ed25519 signature under the builder key from the trusted
`/attestation/pubkey` channel — **not** the envelope's own self-asserted key.

## Signing key

The demo derives its seed from the WitSeal repo **TEST-ONLY** fixture seed
(`test-only-do-not-use-in-prod.key.json`). **Never** sign anything real with it.

A production Worker loads its seed from a Workers secret and never embeds key
material in source:

```sh
npx wrangler secret put WITSEAL_SIGNING_SEED_HEX   # 64 hex chars (32-byte Ed25519 seed)
```

When the secret is absent (local dev / demo) the fixture seed is used so the path
runs with no configuration.

## Compatibility notes

- Standard WebCrypto **Ed25519** (`{ name: "Ed25519" }`) is used — the modern
  standard algorithm, available on current Workers compatibility dates. (The
  legacy non-standard `NODE-ED25519` name is **not** used.)
- The receipt module uses only WebCrypto and Web-standard globals
  (`TextEncoder`, `btoa`/`atob`), so **no** `nodejs_compat` flag is required.

See [COVERAGE.md](COVERAGE.md) for the exact verification evidence and the scope
boundary.
