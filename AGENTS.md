# Working on C.O.R.

For installation tasks, read [SETUP.md](SETUP.md) and follow its inspection, secret-handling and verification steps before changing the environment.

## Cost policy

The owner cannot pay for hosted automation. Do not add, enable or run GitHub Actions, hosted CI, paid model fallbacks or other metered services. Run verification locally or on the existing owner-managed Linux server. Public repository visibility is not authorization for paid usage. Any exception requires explicit owner approval after explaining the cost and enforcing a spending limit.

Production deployment uses the owner's Linux update controller, which fetches Git directly. It does not depend on GitHub Actions. Do not replace it with hosted automation.

## Development boundaries

- Keep credentials, personal records, runtime state and backups out of Git.
- Keep the old private installation history out of public branches and tags.
- Preserve operation validation, current versions, idempotency and sensitive-action approval.
- Write technical documentation and skills in English. Assistant reply preferences belong to the owner profile.
- Use meaningful checks for runtime changes. Documentation-only changes do not require repeating the entire test suite.
