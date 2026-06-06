/**
 * Node harness — runs the EXACT WebCrypto receipt module that the Worker uses,
 * to produce a v0.2 receipt for a Worker-owned isolate-native action, then
 * writes it to disk for `witseal verify` to check.
 *
 * Node's WebCrypto (`globalThis.crypto.subtle`) implements Ed25519 and SHA-256
 * with the same semantics as the Workers isolate, so running the unmodified
 * `signReceiptV02` here IS the in-isolate crypto path — a faithful live-verify
 * of the receipt the Worker produces.
 */
import { writeFileSync } from 'node:fs';
import {
  buildDemoReceipt,
  TEST_SEED_HEX,
} from '../src/index-receipt-factory.js';
import { derivePublicKeyHex } from '../src/witseal-receipt.js';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function main() {
  const outPath = process.argv[2] ?? '/tmp/worker-receipt.json';
  const pubPath = process.argv[3] ?? '/tmp/worker-pubkey.hex';

  const seed = hexToBytes(TEST_SEED_HEX);
  const receipt = await buildDemoReceipt(seed);
  const pubHex = await derivePublicKeyHex(seed);

  writeFileSync(outPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  writeFileSync(pubPath, pubHex + '\n', 'utf8');

  process.stdout.write(`receipt written: ${outPath}\n`);
  process.stdout.write(`public key hex : ${pubHex}\n`);
  process.stdout.write(`receipt_hash   : ${receipt.receipt_hash}\n`);
  process.stdout.write(`signature      : ${receipt.signature}\n`);
}

main().catch((e) => {
  process.stderr.write(`harness error: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
