/**
 * GENERATED — do not edit.
 * =============================================================================
 * This file is written by `scripts/gen-provenance.mjs` at build time. Any manual
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
 * (`src/index-receipt-factory.ts`) so the receipts the Worker emits carry the
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
 * The all-zeros `gitCommit` is the dev sentinel that means "this file has not yet
 * been regenerated from a real build". After `scripts/gen-provenance.mjs` runs in
 * a git context, `gitCommit` is a real 40-hex commit (!= zeros), `artifactDigest`
 * is the sha256 of the built bundle, `attestationDigest` is the sha256 of the
 * DSSE in-toto attestation of that bundle, and `buildId` is the CI run id (or the
 * wrangler version) of the build.
 */

/** The shape of the Worker's build provenance (1:1 with the v0.2 receipt's
 *  build-provenance fields). */
export interface BuildProvenance {
  /** Bare 40-char lowercase SHA-1 git commit of the source the bundle was
   *  built from. Sentinel `0000…0` (40 zeros) until regenerated. */
  readonly gitCommit: string;
  /** `sha256:` + 64-hex digest of the built Worker bundle. */
  readonly artifactDigest: string;
  /** `sha256:` + 64-hex digest of the DSSE in-toto attestation of the bundle. */
  readonly attestationDigest: string;
  /** Free-form build identifier (CI run id, or `wrangler@<version>` locally). */
  readonly buildId: string;
  /** Artifact taxonomy literal. The existing `generic-binary` value. */
  readonly artifactType: string;
}

/**
 * Real build provenance for THIS build, written by scripts/gen-provenance.mjs.
 * gitCommit is the real source commit; artifactDigest is sha256 of the built
 * Worker bundle; attestationDigest is sha256 of the DSSE in-toto attestation of
 * that bundle; buildId is the CI run id or the local wrangler version.
 */
export const BUILD_PROVENANCE: BuildProvenance = {
  gitCommit: "46325dfc951450c631e5dd85f4ad05a7dc32a34d",
  artifactDigest: "sha256:25e60bd8082d49a91939fea207e5127c224f0f69592a528803ed09a15acf51da",
  attestationDigest: "sha256:9f67fbd181274c17af0bd156b4999dccc33d66ff80451589d9280aefee68219e",
  buildId: "wrangler@4.98.0",
  artifactType: "generic-binary",
};

/** The build's DSSE in-toto attestation, surfaced so the Worker can PUBLISH it
 *  (GET /attestation, GET /attestation/pubkey) and a third party can close the
 *  provenance loop with the unmodified `witseal verify --check-provenance`. */
export interface BuildAttestation {
  /** The EXACT DSSE in-toto envelope text. Its sha256 equals
   *  `BUILD_PROVENANCE.attestationDigest` (== `receipt.attestation_digest`), so
   *  serving these bytes verbatim lets a verifier bind the envelope to the
   *  receipt byte-for-byte. Served at `GET /attestation`. */
  readonly envelope: string;
  /** The builder (attestation) Ed25519 public key, lowercase hex. This is the
   *  TRUSTED `--builder-key` that authenticates the DSSE signature; the verifier
   *  must take it from this trusted channel, NOT from the envelope's own
   *  self-asserted `publicKeyHex`. Served at `GET /attestation/pubkey`. */
  readonly builderPublicKeyHex: string;
}

/** This build's DSSE attestation envelope + the builder public key that signs
 *  it, written by scripts/gen-provenance.mjs. */
export const BUILD_ATTESTATION: BuildAttestation = {
  envelope: "{\n  \"payloadType\": \"application/vnd.in-toto+json\",\n  \"payload\": \"eyJfdHlwZSI6Imh0dHBzOi8vaW4tdG90by5pby9TdGF0ZW1lbnQvdjEiLCJzdWJqZWN0IjpbeyJuYW1lIjoid2l0c2VhbC13b3JrZXJzIiwiZGlnZXN0Ijp7InNoYTI1NiI6IjI1ZTYwYmQ4MDgyZDQ5YTkxOTM5ZmVhMjA3ZTUxMjdjMjI0ZjBmNjk1OTJhNTI4ODAzZWQwOWExNWFjZjUxZGEifX1dLCJwcmVkaWNhdGVUeXBlIjoiaHR0cHM6Ly9zbHNhLmRldi9wcm92ZW5hbmNlL3YxIiwicHJlZGljYXRlIjp7ImJ1aWxkVHlwZSI6Imh0dHBzOi8vd2l0c2VhbC5kZXYvd29ya2Vycy9idWlsZC92MSIsImJ1aWxkZXIiOnsiaWQiOiJodHRwczovL3dpdHNlYWwuZGV2L3dvcmtlcnMvbG9jYWwtYnVpbGQifSwiaW52b2NhdGlvbiI6eyJjb25maWdTb3VyY2UiOnsidXJpIjoiZ2l0K2h0dHBzOi8vd2l0c2VhbC5kZXYvd2l0c2VhbC13b3JrZXJzIiwiZGlnZXN0Ijp7InNoYTEiOiI0NjMyNWRmYzk1MTQ1MGM2MzFlNWRkODVmNGFkMDVhN2RjMzJhMzRkIn19fSwibWV0YWRhdGEiOnsiYnVpbGRJbnZvY2F0aW9uSWQiOiJ3cmFuZ2xlckA0Ljk4LjAiLCJhcnRpZmFjdFR5cGUiOiJnZW5lcmljLWJpbmFyeSJ9fX0=\",\n  \"signatures\": [\n    {\n      \"keyid\": \"witseal-workers-build-attestation-dev\",\n      \"sig\": \"ttlTmxcQgz+l2zfQNECch5+FEiv+r2aI0FpZTkxcOFZ7gssPTExNK8z8jxNnQrJZJXBl+DBaPNMlUzbTRNQUDg==\",\n      \"publicKeyHex\": \"3ccd241cffc9b3618044b97d036d8614593d8b017c340f1dee8773385517654b\",\n      \"_dev_key_warning\": \"DEV attestation key — not for real releases\"\n    }\n  ]\n}\n",
  builderPublicKeyHex: "3ccd241cffc9b3618044b97d036d8614593d8b017c340f1dee8773385517654b",
};
