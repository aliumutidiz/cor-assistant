# Modular installation

## Local demo

Use Node.js 24 LTS (22 or newer is supported), clone the repository and run `npm ci`, `npm run setup`, choose local demo, then `npm run dev`. The setup command creates independent secrets and refuses to overwrite an existing `.env`. Demo data is temporary and does not contact Google or Telegram. Do not expose development mode outside the local computer.

## Persistent installation

1. Install Node.js and Docker (or supply an independently managed PostgreSQL database).
2. Create a Google OAuth **Web application** client and enable Google Calendar API. Download its client JSON privately. Register `<APP_ORIGIN>/api/oauth/callback` exactly as an authorized redirect URI.
3. Run `npm run setup` and choose persistent installation. Provide the app origin, owner email and OAuth JSON path. The command reads credentials locally and generates installation-specific secrets and a PostgreSQL password; it never prints them. Existing `.env` files are preserved. On Windows also keep the directory restricted to your account using normal NTFS permissions.
4. Run `docker compose up -d db`, `npm run migrate`, then `npm run dev` for loopback development. If port 5432 is already used, provision another PostgreSQL endpoint and adjust `.env` rather than replacing an existing database.
5. For HTTPS production, review `.env`, configure the reverse proxy/tunnel, run `npm run build` and start with `npm start` under the documented service manager. Production enforces owner login, HTTPS, persistent PostgreSQL and independent secrets. A local setup wizard does not replace server/proxy administration.
6. Sign in as the configured owner and open Settings → Setup. Connect Google Calendar. Configure Telegram and optional research in their tabs. AGY installation/login/isolation and offline speech models are separate modules; no arbitrary downloaded CLI is automatically installed or trusted.
7. Set up encrypted backups and verify restoration in a separate database before relying on the installation.

Infrastructure bootstrap settings (database, HTTPS origin, Google owner-login client, isolation policy and encryption root key) remain operator configuration. The assistant cannot edit them. User integration settings, Telegram allowlists and optional research are managed in the UI. There is no public first-visitor-becomes-admin flow.

## Optional local web search

Review the upstream [SearXNG container guide](https://docs.searxng.org/admin/installation-docker.html). Add a reviewed image tag or digest as `SEARXNG_IMAGE` and an independently generated secret as `SEARXNG_SECRET` in `.env`, then run:

```sh
docker compose -f compose.research.yaml up -d
```

The module binds port 8088 only to loopback and limits the container to 384 MB RAM. The included settings enable JSON search. In the C.O.R. owner UI, set the research origin to `http://127.0.0.1:8088/`, enable it, save, then run the visible connection test. The application must share the host network or otherwise have an explicitly configured reachable loopback adapter. Do not expose SearXNG publicly through the tunnel.

Upstream engines can throttle, block or return partial results. API validation and one successful check do not guarantee search quality or engine availability. Research remains unavailable until the service is actually configured and healthy; the model must disclose this rather than pretend to browse.

## Platform support

The React/Node application and bridge-network Docker preview are portable across Windows, Linux and macOS with a compatible Node/Docker installation. The native isolated AGY broker, systemd auto-updater and local speech provisioning scripts target Linux; they are not automatically installed by the preview. Windows/Linux development and Linux service operation have been exercised. macOS verification remains pending. Verification commands run locally; GitHub Actions is not required.

## No-configuration container preview

Run `docker compose -f compose.demo.yaml up --build -d` and open http://localhost:5173. No `.env` or account is required. The demo publishes only loopback, stores disposable in-memory records and leaves AI and integrations disconnected. Stop it with `docker compose -f compose.demo.yaml down`.

## Diagnostics

Run `npm run doctor` after setup. It validates configuration without printing secrets, checks PostgreSQL in persistent mode, verifies required skills and describes disabled optional AI. A successful doctor check does not prove Google permissions, Telegram delivery or model availability. Verify those through the owner UI.

## Production containers

After the persistent wizard and HTTPS proxy configuration, `docker compose up -d --build` starts the app and database. The app reaches PostgreSQL through the private `db` hostname and publishes `127.0.0.1:3001`. Native AGY is deliberately disabled in this portable image. Host PostgreSQL is separately available on loopback port 5432 for operator migration/backup tools. Back up the named volume and encryption keys before upgrades. Never use `down -v` on an installation you want to keep.
