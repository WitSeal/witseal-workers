#!/usr/bin/env node
/**
 * gen-provenance.mjs — compute the Worker's REAL L4 build provenance and write
 * `src/provenance.gen.ts`.
 *
 * Run at build time, in a git context, after (or together with) building the
 * Worker bundle:
 *
 *     node scripts/gen-provenance.mjs
 *
 * What it does
 * ------------
 *   1. gitCommit          = env GITHUB_SHA, else `git rev-parse HEAD`
 *                           (bare 40-hex lowercase SHA-1).
 *   2. Build the Worker bundle if it is not already present (or FORCE_BUILD=1)
 *      via `wrangler deploy --dry-run --outdir <dir>`, then read the bundle.
 *   3. artifactDigest      = "sha256:" + sha256(bundle bytes).
 *   4. attestation         = a DSSE (in-toto) envelope of the bundle, signed
 *      with Ed25519 over the PAE pre-authentication encoding (node:crypto
 *      Ed25519 — the same algorithm family as `witseal sign-v0.2`). Written to
 *      <outdir>/provenance.intoto.dsse.json for the operator's attested deploy.
 *   5. attestationDigest   = "sha256:" + sha256(attestation envelope bytes).
 *   6. buildId             = env GITHUB_RUN_ID, else "wrangler@<version>".
 *   7. artifactType        = "generic-binary" (existing v0.2 taxonomy value).
 *   8. Write `src/provenance.gen.ts` with these values + a GENERATED header.
 *
 * GOLDEN / CANON SAFETY
 * ---------------------
 * This script does NOT touch the witseal receipt schema, the v0.2 canon, or the
 * golden vector. The five values it produces fill the build-provenance fields
 * that ALREADY EXIST (mandatory) in the v0.2 receipt — turning the inline
 * sentinels in the factory into real build context. `artifact_type` stays the
 * existing `generic-binary` literal (no new taxonomy value is introduced).
 *
 * ATTESTATION FORMAT (DSSE / in-toto, Ed25519, offline)
 * -----------------------------------------------------
 *   envelope  = { payloadType, payload: base64(statement_bytes),
 *                 signatures: [{ sig: base64(ed25519_sig), keyid }] }
 *   payloadType = "application/vnd.in-toto+json"
 *   statement = { _type, subject:[{ name, digest:{ sha256:<hex> } }],
 *                 predicateType:"https://slsa.dev/provenance/v1", predicate:{…} }
 *   PAE       = "DSSEv1 " + len(payloadType) + " " + payloadType + " "
 *                         + len(payload_raw_bytes) + " " + payload_raw_bytes
 *   sig       = Ed25519(PAE)            (the payload bytes are the raw statement
 *                                        bytes, NOT the base64 text)
 *
 * Signing key for the ATTESTATION (distinct from the receipt signing seed):
 *   env WITSEAL_ATTESTATION_SEED_HEX (64 hex chars), else a deterministic
 *   DEV-ONLY seed so the offline build path runs with no configuration. The dev
 *   seed is clearly labelled and must never sign a real release attestation.
 */
import {
  execFileSync,
} from 'node:child_process';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
} from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC_OUT = join(REPO_ROOT, 'src', 'provenance.gen.ts');

/** DEV-ONLY Ed25519 attestation seed. NEVER sign a real release with this. A
 *  real build sets WITSEAL_ATTESTATION_SEED_HEX (or wires an OIDC/KMS signer). */
const DEV_ATTESTATION_SEED_HEX =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const ATTESTATION_KEYID = 'witseal-workers-build-attestation-dev';
const DSSE_PAYLOAD_TYPE = 'application/vnd.in-toto+json';

// ───────────────────────── small helpers ─────────────────────────

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function tryGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

/** Resolve the source git commit: GITHUB_SHA, else `git rev-parse HEAD`. */
function resolveGitCommit() {
  const env = (process.env.GITHUB_SHA ?? '').trim().toLowerCase();
  if (/^[0-9a-f]{40}$/.test(env)) return env;
  const head = (tryGit(['rev-parse', 'HEAD']) ?? '').toLowerCase();
  if (/^[0-9a-f]{40}$/.test(head)) return head;
  throw new Error(
    'gen-provenance: could not resolve a 40-hex git commit ' +
      '(set GITHUB_SHA or run inside a git work tree)'
  );
}

/** wrangler version string, for the local buildId fallback. */
function wranglerVersion() {
  try {
    const v = execFileSync(
      'npx',
      ['--no-install', 'wrangler', '--version'],
      { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim();
    // wrangler prints e.g. " ⛅️ wrangler 4.x.y" or "4.x.y"; take the last token.
    const m = v.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : v.split(/\s+/).pop() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Produce (or locate) the built Worker bundle bytes. Uses wrangler's dry-run
 * deploy to emit the bundled single-file Worker into a temp outdir, then reads
 * the largest emitted .js as the bundle. If BUNDLE_PATH is set, that file is
 * read directly (lets CI pass an already-built artifact deterministically).
 */
function buildAndReadBundle() {
  const explicit = (process.env.BUNDLE_PATH ?? '').trim();
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`gen-provenance: BUNDLE_PATH not found: ${explicit}`);
    }
    return { bytes: readFileSync(explicit), source: explicit };
  }

  const outdir = mkdtempSync(join(tmpdir(), 'witseal-worker-bundle-'));
  try {
    execFileSync(
      'npx',
      [
        '--no-install',
        'wrangler',
        'deploy',
        '--dry-run',
        '--outdir',
        outdir,
      ],
      { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    throw new Error(
      'gen-provenance: `wrangler deploy --dry-run --outdir` failed ' +
        `(${err instanceof Error ? err.message : String(err)}). ` +
        'Set BUNDLE_PATH to an already-built bundle to bypass the build.'
    );
  }
  const jsFiles = readdirSync(outdir).filter((f) => f.endsWith('.js'));
  if (jsFiles.length === 0) {
    throw new Error(`gen-provenance: no .js bundle emitted into ${outdir}`);
  }
  // The single-file Worker bundle is the largest emitted .js.
  let best = jsFiles[0];
  let bestSize = -1;
  for (const f of jsFiles) {
    const p = join(outdir, f);
    const size = readFileSync(p).length;
    if (size > bestSize) {
      best = f;
      bestSize = size;
    }
  }
  const bundlePath = join(outdir, best);
  return { bytes: readFileSync(bundlePath), source: bundlePath, outdir };
}

// ─────────────────── DSSE / in-toto attestation ───────────────────

function loadAttestationKey() {
  const hex = (
    process.env.WITSEAL_ATTESTATION_SEED_HEX ?? DEV_ATTESTATION_SEED_HEX
  )
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(
      'WITSEAL_ATTESTATION_SEED_HEX must be 64 hex chars (32-byte Ed25519 seed)'
    );
  }
  const seed = Buffer.from(hex, 'hex');
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed,
  ]);
  const privateKey = createPrivateKey({
    key: pkcs8,
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({
    format: 'der',
    type: 'spki',
  });
  const publicKeyHex = Buffer.from(spki.subarray(spki.length - 32)).toString(
    'hex'
  );
  const isDev = hex === DEV_ATTESTATION_SEED_HEX;
  return { privateKey, publicKeyHex, isDev };
}

/** DSSE PAE pre-authentication encoding over the raw payload bytes. */
function dssePAE(payloadType, payloadBytes) {
  const head = Buffer.from(
    `DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ` +
      `${payloadBytes.length} `,
    'utf8'
  );
  return Buffer.concat([head, payloadBytes]);
}

/**
 * Build the in-toto Statement, wrap it in a signed DSSE envelope (Ed25519 over
 * PAE), and return the envelope object + its canonical-serialized bytes.
 */
function buildDsseAttestation({
  gitCommit,
  bundleSha256Hex,
  buildId,
  artifactType,
  bundleSource,
  privateKey,
  publicKeyHex,
  keyDev,
}) {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [
      {
        name: 'witseal-workers',
        digest: { sha256: bundleSha256Hex },
      },
    ],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildType: 'https://witseal.dev/workers/build/v1',
      builder: {
        id: process.env.GITHUB_RUN_ID
          ? 'https://github.com/actions'
          : 'https://witseal.dev/workers/local-build',
      },
      invocation: {
        configSource: {
          uri: 'git+https://witseal.dev/witseal-workers',
          digest: { sha1: gitCommit },
        },
      },
      metadata: {
        buildInvocationId: buildId,
        artifactType,
        bundleSubject: bundleSource,
      },
    },
  };

  // payload = raw bytes of the JSON statement (these exact bytes are signed via
  // PAE and base64'd into the envelope payload).
  const payloadBytes = Buffer.from(JSON.stringify(statement), 'utf8');
  const pae = dssePAE(DSSE_PAYLOAD_TYPE, payloadBytes);
  const sig = edSign(null, pae, privateKey); // Ed25519: algorithm is keyed.

  const envelope = {
    payloadType: DSSE_PAYLOAD_TYPE,
    payload: payloadBytes.toString('base64'),
    signatures: [
      {
        keyid: ATTESTATION_KEYID,
        sig: sig.toString('base64'),
        publicKeyHex,
        ...(keyDev ? { _dev_key_warning: 'DEV attestation key — not for real releases' } : {}),
      },
    ],
  };
  const envelopeBytes = Buffer.from(
    JSON.stringify(envelope, null, 2) + '\n',
    'utf8'
  );
  return { envelope, envelopeBytes };
}

// ─────────────────────────── emit .ts ─────────────────────────────

function renderProvenanceTs(p) {
  return `/**
 * GENERATED — do not edit.
 * =============================================================================
 * This file is written by \`scripts/gen-provenance.mjs\` at build time. Any manual
 * edit will be overwritten on the next build. To change the values, run:
 *
 *     node scripts/gen-provenance.mjs
 *
 * (Run it in a git context, after the Worker bundle has been built, so the
 * fields below carry REAL build provenance — see scripts/gen-provenance.mjs and
 * COVERAGE.md.)
 * =============================================================================
 *
 * WHAT THIS IS
 * ------------
 * The Worker's real L4 build provenance, surfaced to the v0.2 receipt factory
 * (\`src/index-receipt-factory.ts\`) so the receipts the Worker emits carry the
 * provenance of the build that is actually running, instead of inline sentinels.
 *
 * The five values map 1:1 onto the v0.2 receipt's build-provenance fields (these
 * fields ALREADY EXIST in the v0.2 canon and the golden — this only fills them
 * with real values; it does NOT change the schema, the canon, or the golden):
 *
 *   gitCommit         -> receipt.git_commit          (bare 40-hex lowercase SHA-1)
 *   artifactDigest    -> receipt.artifact_digest     ("sha256:" + 64-hex)
 *   attestationDigest -> receipt.attestation_digest  ("sha256:" + 64-hex)
 *   buildId           -> receipt.build_id            (free-form build identifier)
 *   artifactType      -> receipt.artifact_type       ("generic-binary": existing
 *                                                      taxonomy value, no new literal)
 *
 * THE VALUES BELOW ARE PLACEHOLDER / DEV DEFAULTS.
 * The all-zeros \`gitCommit\` is the dev sentinel that means "this file has not yet
 * been regenerated from a real build". After \`scripts/gen-provenance.mjs\` runs in
 * a git context, \`gitCommit\` is a real 40-hex commit (!= zeros), \`artifactDigest\`
 * is the sha256 of the built bundle, \`attestationDigest\` is the sha256 of the
 * DSSE in-toto attestation of that bundle, and \`buildId\` is the CI run id (or the
 * wrangler version) of the build.
 */

/** The shape of the Worker's build provenance (1:1 with the v0.2 receipt's
 *  build-provenance fields). */
export interface BuildProvenance {
  /** Bare 40-char lowercase SHA-1 git commit of the source the bundle was
   *  built from. Sentinel \`0000…0\` (40 zeros) until regenerated. */
  readonly gitCommit: string;
  /** \`sha256:\` + 64-hex digest of the built Worker bundle. */
  readonly artifactDigest: string;
  /** \`sha256:\` + 64-hex digest of the DSSE in-toto attestation of the bundle. */
  readonly attestationDigest: string;
  /** Free-form build identifier (CI run id, or \`wrangler@<version>\` locally). */
  readonly buildId: string;
  /** Artifact taxonomy literal. The existing \`generic-binary\` value. */
  readonly artifactType: string;
}

/**
 * Real build provenance for THIS build, written by scripts/gen-provenance.mjs.
 * gitCommit is the real source commit; artifactDigest is sha256 of the built
 * Worker bundle; attestationDigest is sha256 of the DSSE in-toto attestation of
 * that bundle; buildId is the CI run id or the local wrangler version.
 */
export const BUILD_PROVENANCE: BuildProvenance = {
  gitCommit: ${JSON.stringify(p.gitCommit)},
  artifactDigest: ${JSON.stringify(p.artifactDigest)},
  attestationDigest: ${JSON.stringify(p.attestationDigest)},
  buildId: ${JSON.stringify(p.buildId)},
  artifactType: ${JSON.stringify(p.artifactType)},
};
`;
}

// ─────────────────────────────── main ─────────────────────────────

function main() {
  const gitCommit = resolveGitCommit();
  const artifactType = 'generic-binary'; // existing v0.2 taxonomy value.
  const buildId =
    (process.env.GITHUB_RUN_ID ?? '').trim() || `wrangler@${wranglerVersion()}`;

  const { bytes: bundleBytes, source: bundleSource, outdir } =
    buildAndReadBundle();
  const bundleSha256Hex = sha256Hex(bundleBytes);
  const artifactDigest = `sha256:${bundleSha256Hex}`;

  const { privateKey, publicKeyHex, isDev } = loadAttestationKey();
  const { envelopeBytes } = buildDsseAttestation({
    gitCommit,
    bundleSha256Hex,
    buildId,
    artifactType,
    bundleSource,
    privateKey,
    publicKeyHex,
    keyDev: isDev,
  });
  const attestationDigest = `sha256:${sha256Hex(envelopeBytes)}`;

  // Persist the DSSE attestation next to the bundle for the operator's attested
  // deploy (the attested deploy itself is the operator action).
  if (outdir) {
    const attPath = join(outdir, 'provenance.intoto.dsse.json');
    writeFileSync(attPath, envelopeBytes);
    process.stdout.write(`attestation written: ${attPath}\n`);
  }

  const provenance = {
    gitCommit,
    artifactDigest,
    attestationDigest,
    buildId,
    artifactType,
  };
  writeFileSync(SRC_OUT, renderProvenanceTs(provenance), 'utf8');

  process.stdout.write(`provenance written: ${SRC_OUT}\n`);
  process.stdout.write(`  gitCommit         : ${gitCommit}\n`);
  process.stdout.write(`  artifactDigest    : ${artifactDigest}\n`);
  process.stdout.write(`  attestationDigest : ${attestationDigest}\n`);
  process.stdout.write(`  buildId           : ${buildId}\n`);
  process.stdout.write(`  artifactType      : ${artifactType}\n`);
  process.stdout.write(
    `  bundle            : ${bundleSource} (${bundleBytes.length} bytes)\n`
  );
  process.stdout.write(
    `  attestation key   : ${isDev ? 'DEV-ONLY (set WITSEAL_ATTESTATION_SEED_HEX for real)' : 'from WITSEAL_ATTESTATION_SEED_HEX'}` +
      ` pub=${publicKeyHex}\n`
  );
}

main();
