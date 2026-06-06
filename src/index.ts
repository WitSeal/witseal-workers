/**
 * WitSeal execution receipts for Cloudflare Workers — demo Worker.
 *
 * A Cloudflare Worker runs in a V8 isolate: there is NO `child_process`, NO
 * `fs`, NO process spawning. The WitSeal CLI / mediated-execution path therefore
 * CANNOT run inside the isolate. Instead, this Worker PRODUCES a canonical
 * WitSeal v0.2 execution receipt IN-isolate, using WebCrypto (`crypto.subtle`),
 * for an isolate-native action it owns.
 *
 * The receipt is byte-for-byte compatible with the unmodified Node
 * `witseal verify`: `src/witseal-receipt.ts` reproduces the WitSeal
 * RFC-8785-subset canonicalizer VERBATIM and the v0.2 single-pre-image rule
 * exactly, porting only the SHA-256 and Ed25519 primitives onto WebCrypto over
 * byte-identical canonical bytes. Canon (schema / 17 fields / golden vector /
 * pre-image rule) is unchanged.
 *
 * SCOPE (honesty ceiling): the Worker witnesses ONE isolate-native action its
 * own handler performs and owns — a deterministic SHA-256 digest of the request
 * body. It does not witness other Worker traffic, the host runtime, other
 * isolates, or anything the handler does not itself perform.
 *
 * Routes:
 *   GET  /            — service banner + usage.
 *   GET  /pubkey      — the Ed25519 public key (hex) for `witseal verify`.
 *   POST /receipt     — perform the witnessed action over the request body and
 *                       return the signed v0.2 receipt JSON.
 *
 * Key handling: the demo derives its seed from the repo TEST-ONLY fixture seed.
 * A production Worker MUST load the seed from a Workers secret binding
 * (`env.WITSEAL_SIGNING_SEED_HEX`) and never embed key material in source.
 */
import { buildDemoReceipt, TEST_SEED_HEX } from './index-receipt-factory.js';
import { derivePublicKeyHex } from './witseal-receipt.js';

export interface Env {
  /** OPTIONAL Workers secret: 64-char hex Ed25519 signing seed. When absent the
   *  demo falls back to the repo TEST-ONLY fixture seed. Never put a real seed
   *  in source — bind it as a secret. */
  WITSEAL_SIGNING_SEED_HEX?: string;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function seedFrom(env: Env): Uint8Array {
  const hex = env.WITSEAL_SIGNING_SEED_HEX ?? TEST_SEED_HEX;
  const seed = hexToBytes(hex);
  if (seed.length !== 32) {
    throw new Error('WITSEAL_SIGNING_SEED_HEX must be 64 hex chars (32 bytes)');
  }
  return seed;
}

const USAGE = `WitSeal execution receipts for Cloudflare Workers (demo)

This Worker produces a canonical WitSeal v0.2 execution receipt in-isolate via
WebCrypto, for an isolate-native action it owns (SHA-256 over the request body).
The receipt verifies VALID under the unmodified Node \`witseal verify\`.

  GET  /pubkey    -> Ed25519 public key (hex) for: witseal verify <file> --public-key <hex>
  POST /receipt   -> signed v0.2 receipt JSON for the SHA-256 of the POST body

Verify a returned receipt:
  curl -s -X POST <worker-url>/receipt --data-binary @payload.bin > receipt.json
  curl -s <worker-url>/pubkey
  node dist/src/cli/index.js verify receipt.json --public-key <hex-from-/pubkey>
`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(USAGE, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (request.method === 'GET' && url.pathname === '/pubkey') {
      const pubHex = await derivePublicKeyHex(seedFrom(env));
      return new Response(pubHex + '\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (request.method === 'POST' && url.pathname === '/receipt') {
      // The witnessed isolate-native action runs over the request body.
      const payload = new Uint8Array(await request.arrayBuffer());
      const receipt = await buildDemoReceipt(
        seedFrom(env),
        payload.length > 0 ? payload : undefined
      );
      return new Response(JSON.stringify(receipt, null, 2) + '\n', {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    return new Response('not found\n', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
