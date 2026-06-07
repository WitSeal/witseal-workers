# Security Policy

`witseal-workers` is a demonstration Cloudflare Worker that produces WitSeal
v0.2 execution receipts in-isolate via WebCrypto. It is part of the WitSeal
project.

## Reporting a Vulnerability

Use the private GitHub Security Advisory form:

<https://github.com/WitSeal/witseal-workers/security/advisories/new>

Include a description, steps to reproduce, the affected commit, and (optionally)
your contact for credit. **Do not file a public issue for security
vulnerabilities.**

We follow a 90-day coordinated disclosure window:

| Step | Target |
|---|---|
| Acknowledgement | within 72 hours |
| Initial assessment | within 7 days |
| Fix or mitigation | within 90 days (high/critical); 180 days (medium/low) |
| Public disclosure | 90 days from report (coordinated), or upon fix release |

## Scope

In scope: the Worker receipt module (`src/`), its WebCrypto signing/verification
path, and the demo harness.

Out of scope: signing-key material itself (provide your own via
`wrangler secret put WITSEAL_SIGNING_SEED_HEX`; the repository ships only a
clearly labelled TEST-ONLY fixture seed), dependency vulnerabilities (report
upstream), and the availability of any deployment you operate.

The reference verifier is the unmodified Node `witseal` CLI: every receipt this
Worker emits is independently verifiable offline.
