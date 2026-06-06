/**
 * Receipt factory for the Worker's isolate-native action.
 *
 * Shared by the Worker fetch handler (`src/index.ts`) and the node verify
 * harness. It builds a full 17-field v0.2 receipt for ONE isolate-native action
 * the Worker itself performs and owns, then signs it on WebCrypto via
 * `signReceiptV02`.
 *
 * WHAT IS WITNESSED (honesty ceiling): a deterministic computed action that the
 * handler performs in-isolate — here, computing a SHA-256 digest over a caller-
 * supplied payload (`crypto.subtle.digest`). The receipt attests THIS action:
 * the classified intent, the policy decision, and the execution result are all
 * the handler's own. It does NOT attest other Worker traffic, the host runtime,
 * other isolates, or any sub-request the handler did not itself issue.
 *
 * The field VALUES below mirror the shape of the reference fixture
 * `witseal/tests/fixtures/golden-receipt/rust-golden.json` so the receipt
 * validates against the unchanged v0.2 schema (all 17 fields, correct regex
 * shapes). The golden vector itself is NOT reused or mutated — this is a
 * distinct receipt describing a distinct action.
 */
import {
  signReceiptV02,
  importEd25519PrivateKey,
  canonicalize,
  type ExecutionReceiptV02,
  type ExecutionReceiptV02Draft,
} from './witseal-receipt.js';

/**
 * The repo TEST-ONLY Ed25519 seed
 * (`witseal/tests/fixtures/golden-receipt/test-only-do-not-use-in-prod.key.json`,
 * `private_key_seed_bytes_hex`). Demo only — NEVER use this seed to sign
 * anything real. A production Worker would load its signing seed from a
 * Workers secret binding and never embed key material in source.
 */
export const TEST_SEED_HEX =
  '2950951f134b988957c5b5e0644e0a16f3139f45858fc920a7303971d404ae9f';

/** Lowercase-hex SHA-256 of `bytes`, via the isolate-native WebCrypto digest. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  const u = new Uint8Array(d);
  let hex = '';
  for (let i = 0; i < u.length; i++) hex += u[i]!.toString(16).padStart(2, '0');
  return hex;
}

/** Stable hash of any JSON value over its WitSeal canonical bytes. */
async function hashCanonical(value: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalize(value)));
}

/**
 * Perform the witnessed isolate-native action and build its signed v0.2
 * receipt.
 *
 * @param seed32  the 32-byte Ed25519 signing seed.
 * @param payload optional bytes the handler digests as its computed action
 *                (defaults to a fixed demo payload so the harness is
 *                deterministic).
 */
export async function buildDemoReceipt(
  seed32: Uint8Array,
  payload?: Uint8Array
): Promise<ExecutionReceiptV02> {
  const body =
    payload ?? new TextEncoder().encode('witseal-workers-demo-payload');

  // ─── The isolate-native action the handler OWNS and performs ────────────
  // Classified intent: "compute a SHA-256 digest of the request body".
  const classifiedIntent = {
    tool: 'workers.compute.sha256',
    description: 'compute SHA-256 digest of caller-supplied payload in-isolate',
    payload_len: body.length,
  };
  // Policy decision: deny-by-default runtime allowed this isolate-native,
  // side-effect-free computation (the Worker's own policy for its own tool).
  const policyDecision = {
    outcome: 'allow',
    rule: 'isolate-native-compute',
    reason: 'side-effect-free digest over caller payload; handler-owned action',
  };
  // Execution result: the actual digest the handler computed.
  const executionResult = {
    digest_sha256: await sha256Hex(body),
    bytes_in: body.length,
  };

  const classified_intent_hash = await hashCanonical(classifiedIntent);
  const policy_decision_hash = await hashCanonical(policyDecision);
  const execution_result_hash = await hashCanonical(executionResult);

  // ─── Assemble the 17-field draft (shapes per the v0.2 schema) ───────────
  const draft: ExecutionReceiptV02Draft = {
    schema_version: 'witseal.receipt.v0.2',
    receipt_id: 'rcpt_workersdemo00000000001',
    witness_event_id: 'evt_workersdemo000000000001',
    chain_segment_id: 'witseal-workers-demo-segment',
    finalized_at: '2026-06-05T12:00:00.000Z',
    policy_decision_hash,
    classified_intent_hash,
    execution_result_hash,
    outcome: 'allowed_executed',
    artifact_digest:
      'sha256:c007606a264a9ef0c0950f3b0f4e542bb09737c64437cd91e47bb2accbc8cb29',
    artifact_type: 'generic-binary',
    build_id: 'witseal-workers-demo-build-0001',
    git_commit: '0000000000000000000000000000000000000000',
    attestation_digest:
      'sha256:fab32ae873e47bc9375351acf767087cb4239fe26a028869f8e3d454bccb500f',
    prev_hash: null,
  };

  const key = await importEd25519PrivateKey(seed32);
  return signReceiptV02(draft, key);
}
