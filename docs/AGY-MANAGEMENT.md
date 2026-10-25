# AGY console, status and conversation history

The native console is a separate unprivileged PTY service that starts only the
fixed official AGY executable. It never offers a shell or accepts executable,
argument, environment or working-directory overrides from HTTP requests. All API
routes require the existing owner session; writes additionally require exact-origin
CSRF validation. The local socket verifies the `cor` UID with Unix peer credentials.
The model broker and console share an exclusive lock, preventing simultaneous use
of the same AGY profile. Closing the terminal ends only that CLI process group.
An idle console ends after 90 seconds without polling, and every console ends after
ten minutes. PTY output stays in bounded memory, never in application request logs.
Browser clipboard writes and direct terminal hyperlinks through OSC escapes are
disabled. An explicit login button accepts only allowlisted Google HTTPS addresses;
it does not automatically open links or submit credentials.

Install reviewed `deploy/agy-console.py` at `/opt/cor-agent/console.py` and its
systemd unit `deploy/cor-agy-console.service`. Both console and broker run as
`cor-agent:cor-llm`, with app credentials, database files, private home directories,
Docker and backups inaccessible. The console permits AGY's normal settings writes
needed for interactive onboarding; automated model calls retain their read-only,
deny-all tool policy and paid-credit prohibition. This is an AGY console, not a
claim that every possible user change inside AGY is prevented.

Opening the console does not automatically sign out or sign in. The owner follows
AGY's official Google login flow manually. Closing it triggers a model-list check;
the owner can also run that check from Settings. C.O.R. does not request or log the
Google password; Google sign-in should be completed on Google's official page.
OAuth credentials remain in the dedicated CLI profile. End-to-end expired-account
reauthentication still requires a real manual login test; PTY startup and model-list
checks alone do not prove that flow. Manual sign-in does not change Google's
consumer-wrapper support restriction documented in `AGY-VERIFICATION.md`.

Model authentication errors update a private connection-state record. The website
refreshes status every 30 seconds. A separate monitor performs a model-list check
when the last connection evidence is at least fifteen minutes old, unless the console
is open. This is not a model prompt and never renews login automatically. An auth
failure queues one Telegram notification per outage, reset after reconnection.
Failures are discovered by a request/check, not by guaranteed immediate revocation
events. Model-list success cannot establish that generation quota recovered.

## Conversation storage and working context

Successful full user/assistant messages are now persisted in PostgreSQL, deduplicated
by request key and exposed to the owner through paginated history. Previously retained
legacy fragments are imported without replacing current data; already discarded
text cannot be reconstructed. Reloading the site restores the latest fifty messages,
with older pages available on demand. Web and Telegram use the same conversation.

Storage is independent from model context. Up to five hundred recent archive rows
are candidates; the working context chooses the latest thirty-two plus up to eight
lexically relevant older messages within a 48,000-character budget. No extra model
call is used to perform that selection. Routing uses a smaller recent excerpt.
The actual Gemini context capacity is larger; these are application cost/transport
budgets, not model capacity claims. Full history is not blindly resent on every
read loop. Prior messages and retrieved material remain untrusted, and old calendar
identifiers/ETags do not bypass the requirement to read current state before writes.


## Conversation continuity

The application is the durable source of conversation history. Telegram clarification state is scoped to the originating chat, expires after 12 hours and survives app restarts. A short answer such as “yes” can resolve the last task question without a new routing call. It never approves a sensitive operation; approval still requires the content-bound button or web action.

The native broker resumes an exact AGY conversation ID using the documented `--conversation` flag. IDs are saved outside Git in a 0600 state file, keyed by application-selected hashed channel/capability scope and schema. Global `--continue` is never used because it could pick up an unrelated interactive console. Different capability schemas and research contexts do not share a provider conversation. Scope metadata is capped at 64 entries with a 30-day lifetime; the application archive is unaffected by expiry.

A new OS process can resume an existing provider conversation; process lifetime and conversation lifetime are different. Cached authentication is reused. The implementation does not claim that the CLI stays running between messages or that subscription access is risk-free. Provider terms, quota and account eligibility remain external requirements. Native provider history may retain previously sent context under the provider's controls; archiving a local memory record is not a remote data deletion request.

Reference: https://www.antigravity.google/docs/cli/headless/ (Continue a conversation and Stream prompts from stdin).
