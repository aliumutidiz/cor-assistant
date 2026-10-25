# Security policy

C.O.R. is an early-preview, single-owner application. Security fixes target the current main branch and latest release. Older snapshots are not maintained security branches.

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/aliumutidiz/cor-assistant/security/advisories/new). Include the affected version, minimal reproduction, impact and a proposed fix if available. Never put credentials, personal calendar data or exploit details in a public issue. If private reporting is unavailable, open a minimal issue asking for a private reporting channel without disclosing the vulnerability.

Reports are handled on a best-effort basis; there is no guaranteed response SLA or bounty program. Please allow a fix and coordinated disclosure before publishing exploit details.

## Deployment requirements

Do not expose demo/development mode to the internet. Production requires PostgreSQL, HTTPS, independent encryption/session keys and configured owner authentication. Keep `.env`, OAuth downloads, backups, speech models, provider sessions and runtime files out of Git. Read docs/SECURITY.md for the threat model and external data flows.

Only the configured owner can send commands. A Telegram group may have other readers; command authorization does not prevent group members reading responses. Use private destinations for sensitive content.

Source changes are not permission to run root commands on an installation. Install and review the root deployment controller separately. Protect the production branch, use a read-only fetch identity and isolate builds from application credentials.
