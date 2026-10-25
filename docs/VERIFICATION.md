# Release verification

The public preview is a clean source snapshot. It contains synthetic documentation screenshots and no private installation history, runtime state, account credentials or production database.

## Checks and scope

- TypeScript validation and production bundle build.
- Domain, memory, authorization, approval, idempotency, recovery and transport tests.
- PostgreSQL-engine persistence coverage; external PostgreSQL checks run against a disposable service in CI.
- Isolated browser checks for calendar/reminder/routine operations, full-page conversation, profile sections, theme, mobile bounds, safe Markdown, restored/paginated history and audio replay.
- Python broker tests for malformed output, denied CLI tools, safe error classification, input bounds and sequential generation.
- Dependency audit and current-source/full-history credential scan before publication.
- Native Linux deployment checks are installation-specific; a passing mock or local demo is not vendor approval or an external-account guarantee.

CI checks core Node behavior on Linux, Windows and macOS; Linux also checks a real disposable PostgreSQL service and browser integration. Review the latest Actions run for actual status rather than treating the workflow definition as evidence of success.

## Reproduce

See README.md for local checks. End-to-end tests use isolated demo ports 3101 and 5273 without loading the operator's `.env`. Documentation fixtures use `example.test` identities. Never run live-write tests against a personal calendar or point `TEST_DATABASE_URL` at production.

A fresh installation must verify its own Google redirect/owner login, Telegram permissions and notification target, chosen provider eligibility/login/isolation, optional speech model and encrypted backup restoration. Hardware restart, internet outage, quota exhaustion and account revocation are distinct exercises; they are not implied by a successful build.

## External CI availability

At the initial publication, GitHub-hosted jobs were rejected before running with an account billing-lock error. The workflow is provided, but its Linux/Windows/macOS runner checks are not a completed verification until that account restriction is resolved. Local Windows checks and the independently isolated Linux deployment build are separate evidence. Do not infer macOS integration certification from the matrix.
