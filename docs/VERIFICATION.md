# Release verification

The public preview is a clean source snapshot. It contains synthetic documentation screenshots and no private installation history, runtime state, account credentials or production database.

## Checks and scope

- TypeScript validation and production bundle build.
- Domain, memory, authorization, approval, idempotency, recovery and transport tests.
- PostgreSQL-engine persistence coverage; external PostgreSQL checks require an operator-provided disposable database.
- Isolated browser checks for calendar/reminder/routine operations, full-page conversation, profile sections, theme, mobile bounds, safe Markdown, restored/paginated history and audio replay.
- Python broker tests for malformed output, denied CLI tools, safe error classification, input bounds and sequential generation.
- Dependency audit and current-source/full-history credential scan before publication.
- Native Linux deployment checks are installation-specific; a passing mock or local demo is not vendor approval or an external-account guarantee.

Run the checks locally or on your own server. This repository does not configure GitHub Actions or require GitHub-hosted runners. Windows and Linux have been exercised; macOS verification remains pending.

## Reproduce

See README.md for local checks. End-to-end tests use isolated demo ports 3101 and 5273 without loading the operator's `.env`. Documentation fixtures use `example.test` identities. Never run live-write tests against a personal calendar or point `TEST_DATABASE_URL` at production.

A fresh installation must verify its own Google redirect/owner login, Telegram permissions and notification target, chosen provider eligibility/login/isolation, optional speech model and encrypted backup restoration. Hardware restart, internet outage, quota exhaustion and account revocation are distinct exercises; they are not implied by a successful build.

## No GitHub Actions dependency

GitHub Actions is disabled for this project. The workflow and scheduled Dependabot update configuration were removed at the owner's request to prevent unintended hosted usage. Local test commands and the independently isolated Linux update controller remain available. Home-server deployment fetches Git directly and does not depend on Actions.

## Independent preview verification

A fresh Linux Docker build of the runtime image was started as a non-root, read-only, capability-dropped demo container with a 512 MB memory limit, a separate loopback port and no provider/Google/Telegram credentials. Its health endpoint, HTML and demo session checks passed; the container was removed afterwards. The local setup wizard and secret-safe diagnostics also passed in an isolated clean-source directory.

A real owner-request test in ephemeral application storage created a 06:00 daily briefing through AGY, then listed that routine in a second turn without creating another operation. This exercised scoped CLI conversation resumption and current routine context without live calendar writes or test Telegram messages. Model availability and interpretation remain fallible; errors must not be reported as successful actions.
