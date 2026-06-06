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
$ node -e '… canonicalize(rust-golden.json) …'
golden bytes: 1050 sha256: 8fc29592fd3317e48caccc9b5c64d01cfa32d5e27846c50f233829e1bb17ef1b
```

The canonical golden receipt remains 1050 bytes with the same SHA-256. This work
re-implements the sign/hash **primitives** on WebCrypto over byte-identical
canonical bytes; it does **not** touch the schema or the golden vector.

## Notes

- Public key passed to the verifier is the raw 32-byte Ed25519 public key as
  64-char hex (`fd62f46e…91862`), derived in-isolate from the seed and served at
  `GET /pubkey`.
- The receipt module is type-clean under `@cloudflare/workers-types`
  (`tsc --noEmit`, no errors).
- The signing seed in the demo is the WitSeal repo **TEST-ONLY** fixture seed;
  production uses a Workers secret (`WITSEAL_SIGNING_SEED_HEX`).
