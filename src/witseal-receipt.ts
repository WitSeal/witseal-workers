/**
 * WitSeal v0.2 execution-receipt production on WebCrypto.
 *
 * Runs inside a Cloudflare Workers V8 isolate (no node:crypto, no fs, no
 * child_process). It produces a canonical WitSeal v0.2 execution receipt for an
 * isolate-native action the Worker itself performs, and that receipt is accepted
 * as VALID by the unmodified Node `witseal verify`.
 *
 * SCOPE OF WITNESS (honesty ceiling)
 * ----------------------------------
 * This module witnesses ONE isolate-native action that this Worker's own
 * handler performs and owns — a deterministic computed action (and, optionally,
 * a fetch sub-request or a D1 write the handler itself issues). It does NOT
 * witness all Worker traffic, the host runtime, other isolates, or anything the
 * handler does not itself perform. The honesty ceiling is the WitSeal-authored
 * tool/handler, nothing wider.
 *
 * CANON IS UNCHANGED
 * ------------------
 * This is NOT a schema change and NOT a new receipt version. The receipt schema,
 * the 17-field canon, the golden vector, and the v0.2 pre-image rule are all
 * untouched. What is re-implemented here is only the two cryptographic
 * PRIMITIVES (SHA-256 and Ed25519) on top of WebCrypto, computed over
 * BYTE-IDENTICAL canonical bytes:
 *
 *   - The `canonicalize` function below is the WitSeal RFC-8785-subset
 *     canonicalizer from `witseal/src/integrity/hash-chain.ts` (the pure-JS
 *     portion, no node dependencies), reproduced VERBATIM. The same input
 *     therefore yields the same canonical byte stream as the reference Node
 *     implementation.
 *   - The v0.2 single pre-image rule from `witseal/src/receipts/sign-v0.2.ts`
 *     is reproduced exactly: pre-image P = the receipt body with
 *     `signature = ""` AND `receipt_hash = <64 hex zeros>`;
 *     `preimageBytes = TextEncoder().encode(canonicalize(P))`; the SAME bytes
 *     feed both `receipt_hash = sha256(preimageBytes)` and the Ed25519
 *     signature. The final wire `signature` carries the `ed25519:` algorithm
 *     prefix; the prefix is NOT part of the signed bytes.
 *
 * Because the bytes are identical and the procedure is identical, the only
 * difference from the Node helper is which crypto engine computes the digest and
 * the signature. `crypto.subtle` (WebCrypto) is available in the Workers isolate
 * and in modern Node, so the exact same module is the in-isolate receipt path.
 */

// ───────────────────────────────────────────────────────────────────────────
// Canonicalization — reproduced VERBATIM from
//   witseal/src/integrity/hash-chain.ts  (the pure-JS, node-free portion).
//
// RFC 8785 (JSON Canonicalization Scheme), minimal subset:
//   - object keys sorted lexicographically (UTF-16 code-unit order)
//   - no whitespace
//   - integers as integers; floats per ECMA-262 ToString
//   - strings minimally escaped per JSON spec (via JSON.stringify)
// ───────────────────────────────────────────────────────────────────────────

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonicalize: non-finite number cannot be serialized');
    }
    return canonicalizeNumber(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]))
        .join(',') +
      '}'
    );
  }

  throw new Error(`canonicalize: unsupported value type ${typeof value}`);
}

function canonicalizeNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER) {
    return String(n);
  }
  return String(n);
}

// ───────────────────────────────────────────────────────────────────────────
// v0.2 pre-image rule — reproduced from witseal/src/receipts/sign-v0.2.ts.
// ───────────────────────────────────────────────────────────────────────────

/** Empty-string sentinel used during signing pre-image construction. */
export const SIGNATURE_SENTINEL = '';

/** All-zeros `receipt_hash` placeholder (64 lowercase hex zeros) used during
 *  the S1 clear-to-defaults pre-image construction. */
export const RECEIPT_HASH_PLACEHOLDER =
  '0000000000000000000000000000000000000000000000000000000000000000';

/** Algorithm-prefix tag carried on the final populated `signature` value.
 *  Schema version 0.2 permits this exact prefix only. */
export const SIGNATURE_ALGORITHM_PREFIX = 'ed25519:';

/**
 * The v0.2 execution receipt — the closed 17-field canon plus the three
 * serialize-skip optionals (omitted when absent; never serialized as null).
 * Field set and types mirror
 * `witseal/schemas/receipt-v0.2.schema.ts`.
 */
export interface ExecutionReceiptV02 {
  schema_version: 'witseal.receipt.v0.2';
  receipt_id: string | null;
  witness_event_id: string;
  chain_segment_id: string;
  finalized_at: string;
  receipt_hash: string;
  policy_decision_hash: string;
  classified_intent_hash: string;
  execution_result_hash: string | null;
  outcome: string;
  prev_hash: string | null;
  signature: string;
  git_commit: string;
  artifact_digest: string;
  attestation_digest: string;
  artifact_type: string;
  build_id: string;
  sigstore_signature?: string;
  classifier_version?: string;
  shadow_mode?: boolean;
}

/** The receipt body before `receipt_hash`/`signature` are populated. */
export type ExecutionReceiptV02Draft = Omit<
  ExecutionReceiptV02,
  'receipt_hash' | 'signature'
>;

// ───────────────────────────────────────────────────────────────────────────
// Hex / base64 helpers (isolate-safe — no node Buffer).
// ───────────────────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hexToBytes: odd-length hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  // btoa is available in the Workers isolate and in modern Node globals.
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

// ───────────────────────────────────────────────────────────────────────────
// WebCrypto primitive bindings.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Import a raw 32-byte Ed25519 private-key seed for signing via WebCrypto.
 *
 * WebCrypto's `importKey("raw", ...)` does not accept Ed25519 private seeds; the
 * portable path is PKCS#8 ("pkcs8"). We wrap the 32-byte seed in the fixed
 * Ed25519 PKCS#8 prefix (the same DER prefix the Node helper uses for raw
 * seeds) and import that.
 */
export async function importEd25519PrivateKey(
  seed32: Uint8Array
): Promise<CryptoKey> {
  if (seed32.length !== 32) {
    throw new Error('importEd25519PrivateKey: seed must be 32 bytes');
  }
  const PKCS8_ED25519_PREFIX = hexToBytes('302e020100300506032b657004220420');
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
  pkcs8.set(PKCS8_ED25519_PREFIX, 0);
  pkcs8.set(seed32, PKCS8_ED25519_PREFIX.length);
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8.buffer.slice(pkcs8.byteOffset, pkcs8.byteOffset + pkcs8.byteLength),
    { name: 'Ed25519' },
    false,
    ['sign']
  );
}

/**
 * Derive the raw 32-byte Ed25519 public key (as lowercase hex) from a seed,
 * via WebCrypto. The trailing 32 bytes of the SPKI export are the raw public
 * key. This is the value to pass to `witseal verify --public-key <hex>`.
 */
export async function derivePublicKeyHex(seed32: Uint8Array): Promise<string> {
  // Import as an extractable JWK-capable key to derive the public component.
  // WebCrypto cannot derive a public key from a private CryptoKey directly, so
  // we import the seed as a JWK private key (extractable) and export its public
  // SPKI form.
  const PKCS8_ED25519_PREFIX = hexToBytes('302e020100300506032b657004220420');
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
  pkcs8.set(PKCS8_ED25519_PREFIX, 0);
  pkcs8.set(seed32, PKCS8_ED25519_PREFIX.length);
  const priv = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8.buffer.slice(pkcs8.byteOffset, pkcs8.byteOffset + pkcs8.byteLength),
    { name: 'Ed25519' },
    true,
    ['sign']
  );
  const jwk = await crypto.subtle.exportKey('jwk', priv);
  // jwk.x is the base64url raw public key (32 bytes).
  const x = (jwk as JsonWebKey).x;
  if (typeof x !== 'string') {
    throw new Error('derivePublicKeyHex: missing public component in JWK');
  }
  const b64 = x.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  const bin = atob(padded);
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  return bytesToHex(raw);
}

/**
 * Build the canonical v0.2 single pre-image bytes for a receipt body.
 *
 * Pre-image P = body with `signature = ""` AND `receipt_hash = <64 zeros>`,
 * canonicalized. The returned bytes feed BOTH the SHA-256 receipt_hash and the
 * Ed25519 signature.
 */
export function signingPreImageBytes(
  body: Record<string, unknown>
): Uint8Array {
  const preImage = {
    ...body,
    signature: SIGNATURE_SENTINEL,
    receipt_hash: RECEIPT_HASH_PLACEHOLDER,
  };
  return new TextEncoder().encode(canonicalize(preImage));
}

/**
 * Sign a v0.2 receipt draft on WebCrypto, producing the finalized 17-field
 * receipt with `receipt_hash` and the algorithm-prefixed `signature` populated.
 *
 *   1. P = draft with signature="" AND receipt_hash=<zeros>.
 *   2. preimageBytes = TextEncoder().encode(canonicalize(P)).
 *   3. receipt_hash  = hex(SHA-256(preimageBytes)).
 *   4. signature     = "ed25519:" + base64(Ed25519-sign(key, preimageBytes)).
 *
 * Steps 3 and 4 consume the SAME bytes.
 */
export async function signReceiptV02(
  draft: ExecutionReceiptV02Draft,
  privateKey: CryptoKey
): Promise<ExecutionReceiptV02> {
  const preImage = signingPreImageBytes(
    draft as unknown as Record<string, unknown>
  );

  // Step 3: receipt_hash = hex(SHA-256(pre-image bytes)).
  const digest = await crypto.subtle.digest('SHA-256', preImage);
  const receipt_hash = bytesToHex(new Uint8Array(digest));

  // Step 4: signature = ed25519_sign over the SAME pre-image bytes.
  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    preImage
  );
  const signature =
    SIGNATURE_ALGORITHM_PREFIX + bytesToBase64(new Uint8Array(sig));

  return { ...draft, receipt_hash, signature } as ExecutionReceiptV02;
}
