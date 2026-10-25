# Deployment and recovery

## Production prerequisites

Use an existing Cloudflare Tunnel and a hostname you control. Select either owner-only Google application login (`AUTH_MODE=google`, see `OWNER-LOGIN.md`) or Cloudflare Access (`AUTH_MODE=cloudflare`). Access mode requires a self-hosted application allowing only `OWNER_EMAIL`; `CF_ACCESS_TEAM` is the team slug and `CF_ACCESS_AUD` is its audience tag. Google mode does not require Access. Configure and verify the selected authentication before enabling public application routing.

Create the Google OAuth web client with callback `https://YOUR_HOST/api/oauth/callback`. It is a browser redirect, not a Google webhook. Google login has a public, browser-bound single-use callback; calendar authorization still requires an authenticated owner session. There is no public bypass route for Calendar push notifications.

Generate independent secrets locally, without sharing them:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Run separately for `ENCRYPTION_KEY`, `SESSION_SECRET` and `BACKUP_KEY`. Keep the encryption and backup keys outside database dumps and encrypted backups. Protect environment files with owner-only permissions. Losing `ENCRYPTION_KEY` means reconnecting Google; losing `BACKUP_KEY` prevents backup recovery.

## Local development database (Windows/Linux)

`compose.local.yaml` runs only PostgreSQL, separately from the production stack, with a persistent `cor_local_data` volume and a loopback-only port at `127.0.0.1:15432`. Set `POSTGRES_PASSWORD` and a matching `DATABASE_URL` in the ignored `.env` file before starting it. Never print expanded Compose configuration because it includes credentials.

```sh
docker compose -f compose.local.yaml up -d
docker compose -f compose.local.yaml exec -T db pg_isready -U cor -d cor
npm run migrate
```

Keep `DEMO_MODE=true` until PostgreSQL is healthy and migration succeeds. Then set `DEMO_MODE=false` and restart the API so it reloads the environment. Run the application with `npm run dev`. Do not remove the database volume when stopping the stack.

## Docker Compose

Set `.env`: `NODE_ENV=production`, `DEMO_MODE=false`, HTTPS `APP_ORIGIN`, `OWNER_EMAIL`, Cloudflare values, Google client values, keys, `POSTGRES_PASSWORD`, and a `DATABASE_URL` using `127.0.0.1:5432`. URL-encode special characters in the password. The app uses Linux host networking so its loopback listener is reachable from an existing host `cloudflared`; PostgreSQL publishes only on loopback. Do not add a public port mapping.

```sh
docker compose up -d --build
docker compose logs --tail 100 app
```

The app runs as a non-root user with a read-only filesystem and no additional Linux capabilities. Migration runs at startup under a PostgreSQL advisory transaction lock. The default image intentionally has no AGY login and Compose forces AGY disabled. CI also defines a real PostgreSQL concurrency suite; it is skipped locally unless `TEST_DATABASE_URL` points to a disposable test database, while the embedded PostgreSQL-engine persistence suite always runs.

Merge `deploy/cloudflare.example.yml` into the existing tunnel without replacing other application routes. Route the chosen hostname to `http://127.0.0.1:3001`. Verify that unauthenticated traffic is blocked and a different Google identity cannot access C.O.R. Do not trust a tunnel alone as authentication.

`/healthz` contains only a generic process health response. A successful health check does not prove that Google or AGY is connected. Check those independently through settings and a real event read/write using a disposable calendar.

## Native service alternative

Install Node.js 24 LTS and PostgreSQL. Put the application in `/opt/cor`, build it, and configure `/etc/cor/cor.env`. Adapt `deploy/cor.service` to actual executable paths. Use a dedicated `cor` account; keep secrets outside the application tree. The service hardening is a starting point to verify on your distribution. A separately isolated AGY runtime requires the verification procedure; do not weaken filesystem protection to expose all host credentials.


## Encrypted backups

Install compatible PostgreSQL client tools (`pg_dump`, `pg_restore`). The operator utility runs without a shell and passes database passwords through process environment rather than command arguments.

```sh
npm run backup
```

`DATABASE_URL`, an independent `BACKUP_KEY`, and optional `BACKUP_DIR` must be present. Successful backups use AES-256-GCM, atomic final filenames and 30-day retention. Partial files are removed on failure. Keep an off-host copy of encrypted backups.

For daily operation, adapt `deploy/cor-backup.service` and `.timer`. Create `/var/backups/cor` owned by the dedicated backup identity; put database credentials, `BACKUP_KEY`, and `BACKUP_DIR=/var/backups/cor` in `/etc/cor/backup.env`. The timer runs at 03:15 Istanbul time with a small random delay. Monitor failed units.

## Restore verification

Create an EMPTY verification database with a different name. Set `RESTORE_DATABASE_URL` to it, then:

```sh
npm run backup:verify -- /path/to/backup.corbak
```

The utility authenticates and decrypts the entire backup to a private temporary file before executing `pg_restore`. It refuses a database with the live database name or existing public tables, restores within one transaction, and checks all expected application tables. It does not overwrite production automatically. Run this on a known-good backup before relying on scheduled backups and after changing database versions. A full operator restore rehearsal has not been performed in this workspace.

## Release and rollback

Before a release, run unit/protocol/PostgreSQL-engine tests, build, browser tests and an encrypted backup. Pin the image and lockfile; avoid unattended provider upgrades. To roll back, restore the previous image/checkout, verify schema compatibility and preserve the current journal. Do not replay unknown jobs. For an actual database restore, stop both app and standalone workers, retain the current database, restore to a separate database, validate it, then explicitly switch the connection string. Revoke old Google sessions if compromise is suspected.
