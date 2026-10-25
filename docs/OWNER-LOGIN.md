# Owner-only application login

Use `AUTH_MODE=google` in production to run without Cloudflare Access. Configure
`OWNER_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, HTTPS `APP_ORIGIN` and
`GOOGLE_REDIRECT_URI=https://cor.example.com/api/oauth/callback` in the private
environment file. Add that exact redirect URI to the existing Google web OAuth
client. Never commit the environment file or client secret.

The public UI shows a Google login button. Only the configured, verified Google
email can establish a session; the accepted Google account ID is then pinned.
Calendar authorization is separate and is available only after application login.
Settings contains a logout button. Persistent
owner sessions last 30 days and are revoked immediately at logout. Expiry is fixed,
not indefinite sliding renewal. Still-valid legacy sessions are upgraded once;
expired/revoked sessions never revive. The shorter CSRF/API session remains
separate and is refreshed when the app opens. Google account MFA is recommended.

Nginx can forward requests to C.O.R. and handle reverse-proxy concerns, but it does
not replace application authentication. Do not trust forwarded email headers.
An existing Cloudflare Tunnel can instead connect directly to C.O.R.'s Unix socket,
avoiding a published application port and changes to other Nginx sites. Preserve
all existing tunnel routes. See `deploy/continuous-deployment.md` for cutover steps.

Before public routing: verify anonymous API denial, owner login, different-account
denial, logout/replay denial, origin/CSRF checks and a production health check. Only one installation may own a Telegram poller and production worker at a time.
