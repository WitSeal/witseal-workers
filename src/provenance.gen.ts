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
  gitCommit: "4a29ca83b3ec633f1adc0bf129bc592819ef7235",
  artifactDigest: "sha256:b8b8720be9bf43570f0564ce8ff3f53d79de16fd3658048ba6d067ebc3d45c7f",
  attestationDigest: "sha256:af4ff5768d743635dbb6b61b51fcfda68eeb9479e0d52690f2ed14259616cba3",
  buildId: "wrangler@4.98.0",
  artifactType: "generic-binary",
};
