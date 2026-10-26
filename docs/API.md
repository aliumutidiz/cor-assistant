# HTTP API v1 contract

The web client uses durable chat requests when `/api/session` advertises `asyncChat`.
`POST /api/chat/requests` accepts `{message}` with a UUID idempotency key and returns
202 immediately. `GET /api/chat/requests/:id` returns queued/running/succeeded/failed
with a result or safe error. Generation runs in a persistent assistant job outside
the HTTP connection lifetime. A repeated key cannot enqueue another command.
Legacy `/api/chat` remains available. Existing owner, CSRF, origin and rate-limit
checks remain in force. Approving an operation immediately executes it and returns
the persisted outcome; a second conversational instruction is unnecessary.

Production API routes require the configured owner identity (Google owner login or Cloudflare Access); authentication endpoints and `/healthz` have their documented bootstrap exceptions. `/api/session` bootstraps a signed API session and returns its CSRF token. Subsequent `/api` requests need the cookie. Mutations require `Origin: APP_ORIGIN` and `X-Cor-Csrf`; operation/chat submissions also require a unique `Idempotency-Key` (8–160 allowed ASCII characters).

The source of truth is `shared/contracts.ts`. Responses never include Google credentials or application secrets. Validation errors use HTTP 400, stale versions/onay conflicts 409, quota 429, disabled integrations 503, and provider timeout 504. Error bodies have `error`, optional `details`, optional `uncertain`.

| Method | Path                                                 | Purpose                                                                           |
| ------ | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/api/session`                                       | Owner, demo/integration flags, preferences, CSRF                                  |
| GET    | `/api/calendars`                                     | Visible calendars                                                                 |
| GET    | `/api/events?calendarId=...&from=...&to=...`         | Expanded events, at most 93 days                                                  |
| GET    | `/api/sharing?calendarId=...`                        | Current ACL entries                                                               |
| GET    | `/api/resources?kind=...&calendarId=...&eventId=...` | Event/master, calendar metadata, bounded instances, settings or colors            |
| GET    | `/api/routines`                                      | Routines and versions                                                             |
| POST   | `/api/routines/preview`                              | Validate routine input and calculate next run without saving                      |
| POST   | `/api/operations`                                    | Validate and persist an action; returns queued or awaiting_approval               |
| POST   | `/api/operations/:id/approve`                        | Body `{hash}` approves only unchanged content                                     |
| POST   | `/api/operations/:id/cancel`                         | Cancel a queued or pending action                                                 |
| GET    | `/api/history`                                       | Latest operations and jobs                                                        |
| GET    | `/api/progress`                                      | SSE `operations` snapshots; reconnect/query history after disconnect              |
| POST   | `/api/chat`                                          | Body `{message}`; selected skill, proposed operation, measured usage if available |
| POST   | `/api/oauth/connect`                                 | Return the Google consent URL                                                     |
| GET    | `/api/oauth/callback`                                | Session-bound Google authorization callback                                       |
| POST   | `/api/sync`                                          | Body `{calendarId}` runs incremental sync                                         |

## Examples

```json
{
  "kind": "routine.create",
  "routine": {
    "name": "Sabah özeti",
    "cron": "0 8 * * *",
    "timeZone": "Europe/Istanbul",
    "kind": "daily_summary",
    "enabled": false
  }
}
```

```json
{
  "kind": "event.create",
  "calendarId": "primary",
  "event": {
    "summary": "Spor",
    "start": { "dateTime": "2026-10-20T09:00:00+03:00", "timeZone": "Europe/Istanbul" },
    "end": { "dateTime": "2026-10-20T10:00:00+03:00", "timeZone": "Europe/Istanbul" }
  },
  "scope": "single",
  "notify": false
}
```

Routine revisions require `routineId` and the current `version`, and include the complete editable routine input. Event mutations require `eventId` and `etag`; series mutations use the master id and master ETag. Following mutations also require `instanceStart` and obey the supported simple-series restrictions. ACL updates to an existing rule require `ruleId` and `etag`. New public/domain/group/owner grants remain high-risk proposals and are subject to Google's permission constraints.

Job states: queued, running, succeeded, failed, unknown. Operation states additionally include awaiting_approval and canceled. An HTTP success for `/api/operations` means persisted/queued, not that Google has already changed. `/api/chat` attempts immediate execution of normal operations and returns the persisted operation outcome; its message reflects succeeded, failed, unknown, pending approval or still-running states. High-risk actions remain pending approval. Always use operation status as execution truth and read the journal or subscribe to progress for background outcomes.

The optional Telegram connector has no public webhook endpoint. It uses outbound long polling and calls the same services after numeric owner/private-chat verification. Job kinds additionally include `telegram_incoming` and `telegram_outgoing`; normal calendar workers do not claim them. `/api/session` includes non-secret Telegram configuration, connection and latest delivery status; bot credentials are never returned.

Independent reminders: owner-only `GET /api/reminders` returns pending and historical reminder records. Writes use `reminder.create`, `reminder.update` and `reminder.cancel` through `/api/operations`. Updates/cancellation require `reminderId` and the current `version`. Input has title, message, enabled, and either an absolute `remindAt` or `event:{calendarId,eventId,minutesBefore}`. Calendar create/update actions optionally accept `telegramReminderMinutes`: omit to preserve, set a number to configure, or null to cancel direct links. See [reminder contracts and delivery semantics](REMINDERS.md).

Personal resources extend memory kinds with `profile`, `program` and `shopping_list`, each requiring its matching typed payload. Existing `memory.create/update/archive/restore` operations and version checks apply. Program occurrences use the read contract `program-occurrences` with a memory ID and optional paired ISO bounds. Search indexes include shopping item names/notes and program entry titles/locations. `GET /api/brain/export` streams current active/archived records as versioned JSON without credentials, chat or revisions. It is not a database backup.

Owner connection settings use `GET/PUT /api/settings/telegram` and `GET/PUT /api/settings/research`. `POST` to their `/check` paths validates the saved transport without sending a Telegram message. Telegram save input includes enabled, ownerId, chatIds, notificationChatId and an optional replacement token; a blank token preserves the current credential. Responses disclose only tokenConfigured. UI settings are not assistant operations and cannot be modified by chat.

The read-only `web-research` skill uses `web-search` (query) and `web-page` (exact returned or owner-supplied public URL). It cannot read private memory/calendar or mutate state. Research is unavailable until its SearXNG service is configured. See [memory, resource and network boundaries](BRAIN-AND-PERSONAL-RESOURCES.md).

## Assistant execution additions

preferences.update accepts an optional validated BCP 47 language tag; omission preserves the saved language. The interface remains English. See [language coverage](LANGUAGES.md).

Model read envelopes support kind=routines with an optional query or routineId. Memory reads and GET /api/memories accept taskState=open or done, filtered before pagination. Tool results may be partial and carry explicit truncation metadata; omission never proves that a record does not exist.

See [conversation controls](CONVERSATIONS.md) for context version checks, local forgetting and bounded history export.

## Availability and live history

GET /api/chat/snapshot returns a stable context version plus the latest 50 chronologically ordered messages. Messages expose an exchangeId for pending/reply deduplication. GET /api/chat/history keeps its ID cursor, resolved through (created_at,id) ordering. Web sessions advertise chatSync.

Personal programs optionally accept blocksTime (omission means true). Calendar event/freebusy reads add program-availability evidence with source limits and DST uncertainty. See [programs](PROGRAMS.md).
