# C.O.R. setup guide for AI assistants

Use this guide when an owner asks an AI coding assistant to install C.O.R. It is an execution guide for the current repository, not permission to change unrelated applications or to use paid services.

Read [AGENTS.md](AGENTS.md) first. Use the owner's language for conversation; keep configuration and technical notes in English. Never claim an installation is complete based only on a successful build.

## A prompt the owner can copy

> Install C.O.R. using SETUP.md and AGENTS.md. Inspect my environment first and preserve existing applications and data. Start with the local demo unless I explicitly request persistent use. Do not use GitHub Actions, paid services, or paid model fallbacks. Never print credentials or ask me to paste them into chat. Complete all steps you can safely perform, and guide me only through the browser login and account-approval steps that need me. Finish by reporting what you verified, what remains disconnected, and how to start, stop, update and back up this installation.

## 1. Inspect before changing anything

Confirm the working directory and inspect the repository status. Check whether this is a fresh checkout or an existing installation. Do not reset local changes, overwrite `.env`, rotate keys, reuse production data in a demo, delete volumes or replace an existing service just to get setup working.

Check the available tools without installing anything yet:

```sh
git --version
node --version
npm --version
docker --version
docker compose version
```

Only check tools needed for the selected route. The Docker demo does not require a host Node installation; the Node route does not require Docker when using the disposable demo or an independently managed database. `docker --version` alone does not prove that Docker Engine is running; use `docker info` and report a stopped daemon accurately.

Record the OS, architecture, available disk/memory and relevant port conflicts. Defaults are 5173 for the web demo, 3001 for the native API/application and 5432 for the standard database. Check these ports with the operating system's normal tools. Never stop an unrelated process to free a port.

Ask only for missing decisions that affect the installation:

| Decision                             | Safe starting point                                          |
| ------------------------------------ | ------------------------------------------------------------ |
| Demo or persistent installation?     | Local, disposable demo                                       |
| Is an installation already present?  | Inspect and preserve it                                      |
| Which computer should run schedules? | The always-on owner-managed server for persistent use        |
| Public access required?              | Loopback only until HTTPS and owner authentication are ready |
| Which optional modules?              | None until the base installation is verified                 |

Windows and Linux have been exercised. The portable web/Node/container stack can be used on macOS with compatible dependencies, but macOS verification remains pending. Native AGY isolation, systemd deployment and the supplied speech provisioning scripts target Linux. Do not promise those native features on every platform.

## 2. Follow these rules throughout setup

- **No paid automation:** do not enable GitHub Actions, hosted CI, paid model fallbacks or other metered services. Downloading source from GitHub and the owner's Linux Git updater do not require Actions. Do not assume that a service or a subscription includes free usage.
- **Keep secrets local:** never print `.env`, OAuth client JSON, session cookies, tokens, private keys or expanded Compose configuration. Do not put credentials in prompts, screenshots, command-line arguments, commits or final reports. Read required values through local files or environment variables without echoing them.
- **Preserve security:** keep demo/development services private. Do not bypass owner authentication, CSRF, approval checks, provider verification gates, TLS checks or process isolation to make a probe pass. Do not expose PostgreSQL, the AGY socket, search service or an unrestricted terminal.
- **Preserve data:** never run `docker compose down -v`, restore over an existing database, regenerate encryption keys or replace an existing tunnel/proxy configuration without an explicit, informed request. Back up before upgrading a persistent installation.
- **Respect boundaries:** Google sign-in, OAuth consent, AGY sign-in and account creation belong to the owner. Explain the exact step and wait for the required action; do not invent approval or handle MFA on their behalf.
- **Do not infer state from old notes:** dated verification records describe a particular exercise, not the state of a fresh installation. Check the current installation's actual status. A healthy process is not proof of working integrations.

## 3. Start the local demo

Use a fresh checkout or an explicitly selected separate demo directory. These commands do not require application credentials.

### Option A — Docker preview

```sh
git clone https://github.com/aliumutidiz/cor-assistant.git
cd cor-assistant
docker compose -f compose.demo.yaml up --build -d
```

Open **http://localhost:5173**. The container serves the built web application and API. It uses temporary in-memory data, publishes only loopback and does not connect to Google, Telegram or an LLM. Data disappears when the container restarts. The first build needs network access and takes longer.

Verify the page and **http://localhost:5173/healthz**. The health response should contain `ok: true`. Open the calendar, Memory, Settings and Assistant pages; a disabled assistant is an expected disconnected state, not an installation failure.

Stop without removing persistent volumes:

```sh
docker compose -f compose.demo.yaml down
```

### Option B — Node preview

Use Node.js 24 LTS; Node 22 or newer is supported.

```sh
npm ci
npm run setup -- --demo
npm run doctor
npm run dev
```

The setup command creates a private `.env` with installation-specific random secrets and refuses to overwrite an existing file. Do not remove an existing `.env` to bypass that safeguard. The dev command runs both the API and Vite; open **http://localhost:5173**. Stop the foreground process with the terminal's normal interrupt action.

If `.env` already exists, inspect only the non-secret mode/origin information and determine whether the owner wants that installation or a separate demo. Never accidentally start live workers or a Telegram poller while testing another instance.

## 4. Prepare a persistent owner installation

A persistent installation needs PostgreSQL, independent encryption/session secrets and a configured owner. Internet exposure additionally requires HTTPS and production authentication. There is no public first-visitor-becomes-admin flow and no local password-login feature in this release.

The standard wizard configures Google owner login. Cloudflare Access is an alternative for operators who already manage it; follow [owner login](docs/OWNER-LOGIN.md) and [deployment](docs/DEPLOYMENT.md), and verify the selected mode. Do not silently switch authentication modes.

### Google Cloud: the owner-controlled step

Explain this distinction before asking the owner to do anything:

- The local demo needs no Google project or account connection.
- A self-hosted Google Calendar integration needs that installation's own OAuth client. C.O.R. does not ship a shared public client secret.
- Google login protects access to C.O.R.; Calendar authorization is a separate consent step.
- OAuth client credentials are not a paid LLM API key. Do not enable billing, buy credits or attach a paid AI project as part of setup.

Guide the owner to create/configure a Google Cloud project, enable **Google Calendar API**, configure the OAuth consent screen and create an OAuth **Web application** client. In testing mode, ensure the intended owner is allowed as a test user. Use Google's current console wording rather than guessing that every label is unchanged.

Register this exact authorized redirect URI, substituting the actual origin:

```text
<APP_ORIGIN>/api/oauth/callback
```

For the standard local Node route, that is `http://localhost:5173/api/oauth/callback`. For production it is `https://<YOUR_HOST>/api/oauth/callback`. Scheme, host, port and path must match. `APP_ORIGIN` is a root origin, without a query string, fragment or application subpath.

Have the owner download the client JSON to a private local location. Ask for its **path**, not its secret contents. The existing wizard reads the file locally. If the assistant cannot read that location, guide the owner to run the wizard instead of asking them to paste credentials into chat.

### Run the wizard and database

From the intended installation directory:

```sh
npm ci
npm run setup
```

Choose **Persistent installation**. Supply the confirmed origin, owner Google email and private OAuth JSON path. Run the wizard interactively; do not fabricate input or pre-approve Google consent. It generates independent keys and a database password, leaves optional modules disabled and preserves an existing `.env`.

For the standard fresh local database:

```sh
docker compose up -d db
npm run migrate
npm run doctor
```

Check database health before migrations. If PostgreSQL already exists or port 5432 is occupied, preserve that service and configure an agreed endpoint instead. An old database volume keeps its original password; changing a Compose variable does not reset it. Never delete the volume to resolve an authentication error. If using a custom password in a connection URL, encode it correctly without exposing it.

Choose **one** application route:

| Route                   | How it runs                                                        | Database address                                             |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| Local development       | `npm run dev`, browser at localhost:5173                           | Host-accessible database, normally 127.0.0.1:5432            |
| Native HTTPS production | `npm run build`, then `npm start` under a reviewed service manager | Host-accessible database from private operator configuration |
| Production Compose      | `docker compose up -d --build` after HTTPS/auth configuration      | App uses the private `db:5432` address supplied by Compose   |

The standard production Compose stack publishes the app only at `127.0.0.1:3001`; the HTTPS gateway forwards to that address. Its database port is separately bound to loopback for host operator tools. Do not point a host command such as `npm run doctor` at the container-only `db` hostname.

An HTTPS origin makes the wizard select production mode. A persistent loopback development setup remains development mode and must not be published through a tunnel. Do not start both a native app and a container app against the same database: duplicate workers/pollers are not a supported deployment arrangement.

## 5. Configure HTTPS and automatic operation

Use [deployment and recovery](docs/DEPLOYMENT.md) and the [Linux update controller](deploy/continuous-deployment.md) for the selected route. Read existing service/proxy/tunnel configuration before proposing changes; preserve other applications and catch-all rules. A tunnel alone is not authentication.

On Linux, adapt service paths and identities to the actual installation, enable the appropriate restart/boot behavior and verify the service status. The root-owned update controller must be reviewed and installed separately; it never replaces itself from Git. Fetch public source over read-only HTTPS, or use a repository-scoped read-only deploy key for a private repository. Do not copy another person's credentials or installation-specific paths.

Before public routing, verify that the production health endpoint works and anonymous requests to `/api/session` and private data endpoints are rejected. Have the owner complete sign-in in their browser. A successful health request is not successful owner login. Do not weaken authentication because the owner has not completed that step yet.

Automatic updates run on the owner's server, not on GitHub-hosted runners. A failed fetch/build preserves the active release; a health failure can restore the previous application release. Database rollback is separate. Do not claim power-loss or internet-recovery testing unless actually exercised with the owner's authorization.

## 6. Finish connections in Settings

After the owner signs in:

1. **Profile & appearance:** ask their preferred name, reply language/style and time zone. Do not hardcode a language into skill files. Existing routines retain their own time zone.
2. **Calendar & security:** connect Google Calendar and let the owner approve the requested scopes. Read calendar names or a bounded interval only if authorized; avoid revealing contents in setup logs. Do not create/delete real events merely to demonstrate that setup works.
3. **Connections overview:** report actual connection states. Unconfigured optional modules must remain visibly disconnected.

Add optional modules only when requested:

| Module         | Setup boundary and verification                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram       | Owner creates/chooses a bot and enters its token, numeric owner ID and allowed destinations in Settings. Tokens are stored encrypted. Confirm the destination before any test message. Use one active poller per bot.                                                                                                                                                   |
| AGY assistant  | Separate official CLI installation, owner login, compatible model and verified Linux process isolation are required. Read [AGY verification](docs/AGY-VERIFICATION.md) and [session management](docs/AGY-MANAGEMENT.md). Do not enable gates by setting booleans without evidence. The portable container intentionally leaves AGY disabled. Never add a paid fallback. |
| Voice input    | Requires separately provisioned local speech runtime/model. Inspect the reviewed scripts in `deploy/`; downloaded models have their own licenses and resource requirements. A successful silence test is not proof of transcription accuracy.                                                                                                                           |
| Spoken replies | Leave disabled unless explicitly requested and the owner has independently verified eligibility and costs. Never enable billing or a paid model to make audio work.                                                                                                                                                                                                     |
| Web research   | Optional SearXNG module in [installation](docs/INSTALLATION.md). Check reachability from the app's actual network namespace. Host loopback is not container loopback; do not solve this by exposing private services or weakening SSRF protection.                                                                                                                      |

AGY sign-in and Google Calendar consent are separate sessions. Conversation history and personal records live in C.O.R.'s database; a provider login or a disconnected connector must not erase them. New schedules default to disabled unless the owner explicitly requests active delivery. Do not create sample routines in a persistent owner workspace.

## 7. Verify only what is relevant

For a source installation, these checks run locally, without GitHub Actions:

```sh
npm run doctor
npm run check
npm test
npm run build
```

Do not install a host Node toolchain solely to run these inside a Docker-only demo. A failed health/integration check needs diagnosis, not repeated full test suites. Core tests do not prove Google/Telegram/provider account availability. The optional live PostgreSQL test suite must use a disposable `TEST_DATABASE_URL`, never the owner's production database.

For frontend checks when needed:

```sh
npx playwright install chromium
npm run test:e2e
```

Browser tests use isolated demo services on ports 3101 and 5273. Preserve any unrelated services already using those ports; adapt the test setup deliberately rather than killing them. Do not collect screenshots containing the owner's real records or credentials.

### Common failures

| Symptom                                  | Next step                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker command exists, but startup fails | Check whether Docker Engine/Desktop is running; do not report the image as broken solely because the daemon is stopped.                                               |
| Setup refuses an existing `.env`         | Preserve it and identify the installation; use a separate directory for a fresh demo.                                                                                 |
| Database authentication fails            | Check the agreed endpoint and original volume credentials privately; do not delete data or print the connection URL.                                                  |
| Google reports a redirect mismatch       | Compare the exact registered callback with `APP_ORIGIN` and `GOOGLE_REDIRECT_URI`; do not log client secrets or authorization codes.                                  |
| Google denies access                     | Check the configured owner, consent/testing status and allowed test users. Do not remove the owner restriction.                                                       |
| Assistant is unavailable                 | Check whether AGY is intentionally disabled, logged out, busy or quota-limited. Keep calendar forms and deterministic routines available; do not add a paid fallback. |
| Telegram is disconnected                 | Check the saved configuration and owner/destination allowlist. Do not start another production poller or send a message to an unconfirmed group.                      |
| A write timed out                        | Inspect the recorded operation outcome before resubmitting. Unknown is not success and is not permission to repeat a possibly completed write.                        |

## 8. Protect and hand over persistent data

Before relying on the installation, configure encrypted backups and verify restoration to an **empty, separate** database using [deployment and recovery](docs/DEPLOYMENT.md). Backups require compatible PostgreSQL client tools and an independent `BACKUP_KEY`; keep both backup and application encryption keys separately from database dumps.

`npm run backup` creates an encrypted backup when configured. `npm run backup:verify -- <backup-file>` additionally requires `RESTORE_DATABASE_URL` for an empty verification database. This command must never target production. Do not expose backup files through the web server or include them in Git. Document the off-host backup location and retention without recording secret values.

Finish with a short, evidence-based handover containing:

- Mode: disposable demo or persistent owner installation.
- Actual OS, installation directory, URL and chosen service/container names.
- Start, stop, update and recovery instructions for this specific route.
- Checks that passed and integrations actually verified; distinguish unavailable, skipped and failed checks.
- Optional modules left disabled and any browser steps still requiring the owner.
- Data/backup locations and the need to preserve encryption keys, without disclosing keys.
- That GitHub Actions and paid fallbacks were not enabled.

Do not call the setup complete if required owner authentication, persistent storage, HTTPS protection or a requested connector remains unverified. State the remaining step precisely; do not invent account access or test results.

This project is single-owner, source-available software under PolyForm Noncommercial 1.0.0. See [licensing](docs/LICENSING.md) before commercial deployment. Third-party components retain their own terms.
