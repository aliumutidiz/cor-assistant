# Security model

## Protected assets and trust boundaries

Assets are the owner's calendar contents, calendar access rights, OAuth refresh token, AGY session, operation approvals and database backups. Internet clients, calendar descriptions, model output and imported skill content are untrusted. Production supports owner-only Google login (`AUTH_MODE=google`) or validated Cloudflare Access JWTs (`AUTH_MODE=cloudflare`). The origin listens on loopback or a permission-controlled Unix socket and must remain unreachable from public interfaces.

## Application login

The AGY console is a separate owner-only API/PTY surface, with CSRF on writes and
Unix peer-UID validation behind the app. It starts a fixed unprivileged AGY process,
not a configurable shell. Console output is bounded and transient. Full conversation
archives are owner-private database content and are included in encrypted backups.
See `AGY-MANAGEMENT.md` for console deadlines, login limits and context selection.

Google login uses authorization code exchange, S256 PKCE, a ten-minute single-use
state record bound to a signed HttpOnly browser cookie, and an ID-token nonce.
The server verifies Google's RS256 signature, issuer, audience, expiry, nonce,
verified owner email and authorized party. The first accepted Google subject is
pinned in the database. Changing the subject requires an explicit administrative
reset; a model or chat message cannot change the allowlist or this binding.

Authentication cookies are Secure, HttpOnly, SameSite=Lax and host-only, using the
`__Host-` prefix in production. The database stores a hash of the opaque session
identifier with an absolute 30-day expiry (explicit owner preference). Successful login rotates existing
authentication and CSRF sessions. Logout requires the normal origin/CSRF checks and
revokes the server record, so copied cookies cease working. Login routes are rate
limited; proxy identity headers do not authenticate Google-mode requests.

Only static UI assets and the bounded login flow are public. Calendar OAuth remains
a separate authenticated action; application login does not request calendar scopes
or overwrite stored calendar tokens. Both flows share the registered callback URI,
but use separate state namespaces and storage. No Google tokens reach the browser.

## Enforced controls

- Access issuer, signature, audience, expiry and owner email are checked server-side. Unverified identity headers alone are insufficient.
- Random signed HttpOnly cookies expire after twelve hours. Mutations require the configured exact Origin and a session-bound CSRF token. OAuth uses PKCE and single-use expiring state bound to the initiating session. The callback verifies Google's ID token and owner email before saving tokens.
- Strict schemas reject unknown action fields. Client-provided URLs, commands or executable skill scripts are not accepted. Google request hosts are fixed. Resource identifiers are URL-encoded.
- High-risk actions use immutable content hashes, expiring approval and atomic state transitions. Current ETags prevent silent overwrites. Model skill selection cannot disable approval policy.
- Tokens are AES-GCM encrypted in PostgreSQL. The encryption key stays outside the database. AGY child processes do not inherit application credentials. Full process isolation remains an external production gate.
- Calendar HTML is rendered only as React text. Security headers disallow framing and external scripts. OAuth query strings, request bodies and sensitive headers are not logged by default.
- An interrupted or ambiguous external write is recorded as unknown rather than automatically retried. Timed-out CLI calls terminate the child; target-OS process-tree containment must be verified before enabling AGY.

## Explicit residual risks

The optional Telegram adapter accepts only the configured numeric owner in the configured private chat or explicitly configured group. It uses outbound long polling rather than an unauthenticated webhook. Voice files are size/duration bounded, decoded in a separate offline-only process and removed after decoding; confident transcripts are interpreted directly after owner checks, while consequential operations retain content-bound approval. Telegram and model delivery share the same validated operation services and approval hashes. Bot tokens are never returned to the browser or passed to the speech process. Telegram transport metadata and transcripts may remain in the authenticated database history. See `TELEGRAM.md` for setup and live acceptance checks.

No software can guarantee absence of vulnerabilities. A compromised host administrator or database/application owner can access secrets. A model may misunderstand a seemingly simple instruction despite schema validation; approval for consequential operations and the journal limit its effects. MFA, credential rotation and separate backups remain deployment responsibilities. The default AGY-disabled state is intentional until the terms and isolation gates are satisfied.

Application data is not end-to-end encrypted from the host: Google and Cloudflare process relevant traffic. When enabled, AGY receives the selected user request and bounded task context under the service's applicable data-use settings. Review account settings before submitting private calendar text. No application telemetry exporter is initialized by default; unexpected exceptions are captured through the local Sentry interface without a configured remote destination.

The local development host check is an extra boundary, not public authentication. Never publish a development Vite server through a tunnel. Use production mode, which refuses missing secrets and Access settings.

## Required production exercises

Verify wrong identity, forged/missing Access JWT, missing CSRF, cross-site Origin, stale ETag, duplicate approval, injected calendar instructions, provider quota, OAuth revocation, worker interruption and restore from backup. Unit tests use mocked Google traffic and a PostgreSQL engine test harness; real Google and Cloudflare settings require a separate disposable-calendar smoke test.
