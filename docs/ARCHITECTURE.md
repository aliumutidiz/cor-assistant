# Architecture and decisions

## Boundaries

The application is a modular monolith, not a network of autonomous agents. HTTP routes delegate to controllers; controllers validate transport input and call framework-independent services. Repositories own PostgreSQL statements. Google and model providers implement separate interfaces. The browser never receives OAuth refresh tokens or provider credentials.

TypeScript is shared across web and server. PostgreSQL is both the durable store and queue, avoiding Redis for a single-owner deployment. `FOR UPDATE SKIP LOCKED` claims one job atomically. Unique request/job keys suppress duplicates. The server embeds a worker; a standalone worker can use the same database. Models never schedule their own wakeups.

## Write lifecycle

1. Validate a strict action schema and its domain preconditions.
2. Classify risk in executable code, including current guest/series context where relevant.
3. Canonically hash the action and insert an immutable proposal under a unique request key.
4. High-risk actions await an exact hash-matching approval, expiring after 15 minutes. Normal actions enter the queue.
5. Persist the job separately. Queue repair recreates missing jobs after a crash between journal insertion and enqueueing.
6. For chat, immediately attempt to compare-and-swap the normal operation from queued to running and invoke the adapter before replying. The durable job remains the recovery path; the same compare-and-swap prevents a racing worker from executing it twice. Other submission endpoints retain asynchronous queue execution.
7. Record confirmed success, definitive failure, or unknown outcome. Unknown writes are never automatically replayed.

Database and Google are not one atomic transaction. The implementation deliberately does not promise exactly-once external delivery. Event creation uses a stable Google-compatible event id. Expired running work becomes unknown after ten minutes. Multi-step recurrence changes disclose partial results rather than pretending to roll back sent notifications.

## Scheduling

Routines store a five-field cron expression, IANA timezone, type, enabled state, optimistic version and next occurrence. Seed routines are disabled. A due run is keyed by routine, revision and occurrence. Schedule advancement uses compare-and-swap. Paused, deleted, revised or more-than-15-minute-old scheduled work is skipped. Explicit manual runs can execute disabled routines. Missed old occurrences do not flood the owner after an outage.

Daily and weekly summaries cover local day boundaries, including timezone transitions; upcoming checks cover the next hour. Summaries and conflict checks are deterministic and do not consume model tokens. Results are persisted in job history. Timezone preference changes do not silently rewrite existing routine timezones.

## Agent orchestration

`ModelProvider.generate(prompt, schema, signal)` returns structured output and optional measured usage. `AgyProvider` wraps the documented official CLI; no private OAuth proxy or alternative LLM API exists. Credentials are managed by the official CLI in a separately verified runtime.

Routing receives a small English skill index. Only the selected skill and relevant action schema are loaded for execution. Conversation history is persistent; the context selector takes up to 32 recent and 8 relevant older messages from the latest 500 stored rows, within a 48,000-character budget. Routing uses a smaller recent subset. A request has one routing call and at most three execution turns, plus one bounded contract-correction call if a write-skill response claims a prepared/completed change without an action. No write is inferred from prose. Referenced event ids and ETags must originate from current tool reads. Routine ids/versions must match authoritative context. Server approval rules apply regardless of skill prose. User-facing operation messages are generated from persisted outcomes, not unverified model claims.

New providers implement the same interface. New capabilities add a validated action contract, executable risk policy, service handler, tests and skill metadata. No dynamic execution of skill-provided code is allowed.

Web and Telegram share a bounded FIFO chat queue (one active request, at most three waiting, 60-second queue deadline). Cancellation removes a queued request without consuming model work. Routing uses the last four messages capped at 800 characters each; execution keeps the larger selected conversation context. One shared recovery budget permits at most one additional pure model generation per chat for transient transport/timeouts or invalid structured output. Authentication, quota, policy and console-busy failures are not retried. Calendar operations are outside this recovery helper and are never replayed by model recovery. Broker logs contain failure class names only, never prompts or provider diagnostics.

Exact common Turkish questions such as “Bugün/yarın/bu hafta neler var?” use a zero-model read path against the primary calendar. Matching is fully anchored; additional instructions, named calendars, mutations or ambiguous wording fall through to skill orchestration. Local midnight boundaries respect timezone/DST and weeks start Monday. Only confirmed event data is formatted, without descriptions or model interpretation. Long lists disclose truncation. Read failures propagate and are never archived as empty calendars. Successful deterministic replies use the same idempotency cache and conversation archive as model replies.

## Sync and frontend

The optional Telegram runtime has separate polling, incoming-processing and outgoing-delivery loops. Updates are durably enqueued before polling offsets advance. Queue claims filter by job kind, isolating slow voice/model work from notification delivery. Routine/operation results feed a persistent outbox through unique source keys; terminal or ambiguous sends are not blindly replayed. Voice is decoded by an offline Python faster-whisper process with a filtered environment, size/time limits and temporary-file cleanup. Confident owner voice transcripts are interpreted directly; only consequential operations require content-bound approval. Durable callback receipts preserve retry and repeated-click status. Configured channel status, not skill prose, determines whether delivery is available.

Google is authoritative. Paginated full/incremental sync commits the final token and snapshot together; HTTP 410 starts a clean full sync. Read failures never become confirmed empty results. UI state is refreshed using authenticated SSE operation snapshots and explicit HTTP reads. SSE reconnects after a bounded connection lifetime.

React uses same-origin `/api` routes. Future Capacitor clients should use system-browser authentication with supported callbacks; do not embed Cloudflare service tokens or Google secrets in a mobile bundle. The web transport is versionable but mobile authentication must be verified before shipping an Android build.

Assistant messages render CommonMark/GFM with raw HTML disabled, safe default link handling and no remote image loads. Telegram replies use the same Markdown syntax converted to plain text plus Bot API entities, not raw HTML or MarkdownV2 interpolation. Long replies split at UTF-16-safe boundaries with entity offsets clipped per chunk; code/pre entities never overlap other formatting. Delivery remains in the durable outbox with existing rate-limit and uncertain-send handling.

Browser API calls handle empty/non-JSON proxy responses explicitly. Only idempotent GET reads retry once after transient network or 502/503/504 failures; writes never retry automatically. History failures remain visible with an explicit reload action. Older-page loading is serialized and deduplicated by archive id. Scroll anchoring preserves the reading position while prepending older messages, and ResizeObserver keeps the latest message visible through font/layout changes only while the reader is following the bottom.

## References

- https://www.antigravity.google/docs/cli/headless/
- https://www.antigravity.google/terms
- https://developers.google.com/workspace/calendar/api/guides/sync
- https://developers.google.com/workspace/calendar/api/guides/recurringevents
- https://github.com/agentskills/agentskills
- https://github.com/LibreChat-AI/LibreChat
- https://github.com/nspady/google-calendar-mcp

These repositories informed modular provider/tool design and calendar scenarios; their source code was not copied wholesale.

Explicit AI routine kinds use a separate ai_report queue partition and a read-only reporting skill; fixed reminder delivery remains independent of model generation. Task memory records support one-time deterministic reminders and non-destructive completion. See PERSONAL-ASSISTANT.md for contracts and limits.

## Conversation lifecycle

See [Conversation controls](CONVERSATIONS.md) for context watermarks, provider conversation rotation, local archive removal and the distinction from personal memory.
