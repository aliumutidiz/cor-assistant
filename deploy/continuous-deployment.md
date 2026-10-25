# Linux continuous deployment

The root-owned `cor-update.py` controller fetches only `main` using a repository-scoped,
read-only SSH deploy key. `cor-fetch` holds that key; `cor-build` runs dependency
installation, tests and the production build in a restricted transient systemd unit.
Neither account can read application credentials. Build subprocesses are stopped
before the controller extracts the artifact into a root-owned release directory.

`cor-update.timer` checks every minute, including after a reboot. The status file is
`/var/lib/cor-deploy/status.json`; inspect failures with `journalctl -u cor-update`.
A failed fetch, test or build preserves the active release. Root deployment scripts
are manually installed and never replaced by repository updates.

Public activation is deliberately gated by the root-owned `/etc/cor/deploy-enabled`.
Before creating that marker:

1. Select authentication in `/etc/cor/cor.env`. With `AUTH_MODE=google`, configure
   the Google client and `OWNER_EMAIL`; Access team/audience are not needed. With
   `AUTH_MODE=cloudflare`, configure owner-only Access and the real team/audience.
2. Add `https://cor.example.com/api/oauth/callback` to Google OAuth redirect URIs.
3. Stop Windows workers and Telegram polling; transfer the final database snapshot.
4. Configure `cor.service` to use `/opt/cor-current`, the installed Node runtime,
   `RuntimeDirectory=cor`, `RuntimeDirectoryMode=0750`, `Group=cor-proxy` and
   `HTTP_SOCKET=/run/cor/http.sock`. Mount `/run/cor` read-only into cloudflared and
   add only the numeric `cor-proxy` supplemental group to that container.
5. Verify that anonymous API requests receive 401, then replace the hostname's `http_status:403` ingress
   with `unix:/run/cor/http.sock`. Preserve the existing catch-all ingress.
6. Enable the application and activation marker, run the updater and verify health
   and unauthorized-access rejection. Never run both production pollers.

Before each activation, the fixed backup helper writes an AES-256-GCM encrypted
`pg_dump` to `/var/backups/cor-deploy`. Back up `/etc/cor/deploy-backup.key` separately.
Format: ASCII `COR1`, 12-byte nonce, 16-byte authentication tag, ciphertext.
If health verification fails, the previous application symlink is restored. Database
schema rollback is not automatic; a reviewed restore may be needed after a migration.
Keep migrations backward compatible. Release and backup retention is manual for now.

Until cutover, new commits are automatically validated and staged, but cannot start
workers or expose calendar data. This is intentionally reported as `staged`, not a
successful production deployment.
