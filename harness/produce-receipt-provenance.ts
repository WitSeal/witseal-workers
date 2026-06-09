/**
 * W5/L4 live-verify harness — produce a Worker v0.2 receipt carrying the REAL
 * build provenance now baked into src/provenance.gen.ts, then write it for
 * `witseal verify`.
 *
 * Runs the EXACT WebCrypto receipt module the Worker uses (buildDemoReceipt),
 * which reads BUILD_PROVENANCE from provenance.gen.ts. Node's crypto.subtle
 * implements Ed25519 + SHA-256 with the same semantics as the Workers isolate,
 * so this is a faithful stand-in for the in-isolate receipt path.
 */
import { writeFileSync } from 'node:fs';
import {
  buildDemoReceipt,
  TEST_SEED_HEX,
} from '../src/index-receipt-factory.js';
import { derivePublicKeyHex } from '../src/witseal-receipt.js';
import { BUILD_PROVENANCE } from '../src/provenance.gen.js';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function main() {
  const outPath = process.argv[2] ?? '/tmp/worker-receipt-provenance.json';
  const pubPath = process.argv[3] ?? '/tmp/worker-pubkey.hex';

  const seed = hexToBytes(TEST_SEED_HEX);
  const receipt = await buildDemoReceipt(seed);
  const pubHex = await derivePublicKeyHex(seed);

  writeFileSync(outPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  writeFileSync(pubPath, pubHex + '\n', 'utf8');

  process.stdout.write(`receipt written : ${outPath}\n`);
  process.stdout.write(`public key hex  : ${pubHex}\n`);
  process.stdout.write(`receipt_hash    : ${receipt.receipt_hash}\n`);
  process.stdout.write(`signature       : ${receipt.signature}\n`);
  process.stdout.write(`-- provenance carried in the receipt --\n`);
  process.stdout.write(`git_commit        : ${receipt.git_commit}\n`);
  process.stdout.write(`artifact_digest   : ${receipt.artifact_digest}\n`);
  process.stdout.write(`attestation_digest: ${receipt.attestation_digest}\n`);
  process.stdout.write(`build_id          : ${receipt.build_id}\n`);
  process.stdout.write(`artifact_type     : ${receipt.artifact_type}\n`);

  // Hard self-check: provenance must be REAL (non-sentinel git_commit).
  if (receipt.git_commit === '0000000000000000000000000000000000000000') {
    throw new Error(
      'git_commit is still the sentinel — provenance.gen.ts was not regenerated'
    );
  }
  if (receipt.git_commit !== BUILD_PROVENANCE.gitCommit) {
    throw new Error('git_commit in receipt != BUILD_PROVENANCE.gitCommit');
  }
}

main().catch((e) => {
  process.stderr.write(
    `harness error: ${e instanceof Error ? e.stack : String(e)}\n`
  );
  process.exit(1);
});
