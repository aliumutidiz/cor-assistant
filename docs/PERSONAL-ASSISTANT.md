# Personal memory and voice

## Design and storage

C.O.R. keeps its React/Fastify/PostgreSQL architecture and existing calendar/routine permissions. Personal memory is a separate domain, not an ever-growing prompt file. `shared/memory.ts` defines strict idea, purchase, fact and task contracts; `server/memory-service.ts` owns domain rules; repositories own persistence; `server/memory-routes.ts` exposes owner-only reads. The UI lives in `src/MemoryPanel.tsx`.

`memory_items` stores one logical record per row with a UUID, monotonic paging sequence, current version, type, title, original body, retrieval summary, tags, nullable occurrence day and precise timestamp, nullable amount/currency, source channel/quote and server recording timestamp. Day-only events keep occurredAt null; date-filter matching uses the full local-day interval with the record's timezone rather than inventing a purchase hour. Amounts are decimal strings; missing prices stay unknown. Recording time is distinct from the time a purchase happened. User qualifications, deposits and installments remain in the original body. Different currencies are never implicitly combined.

Turkish and simple-language full-text search use a versioned immutable search-vector function and GIN index, including tags. Explicit dotted/dotless-I handling and accent-folded aliases support Turkish uppercase and ASCII-typed queries without changing original text. Prefix queries are built only from bounded letter/number tokens and passed as SQL parameters. Normalized recent-order keyset pagination avoids a full archive download. No embedding API or model call is needed for storage, search, UI edits, revision inspection or Markdown exports.

`memory_revisions` stores immutable snapshots under `(memory_id, version)` and a unique operation id. A single SQL statement commits the current record and revision together, with an optimistic version precondition. Replayed operation ids return their existing snapshot. Archive requires normal content-bound approval; restore is reversible. Archiving excludes a record from active retrieval while retaining revisions, conversations and encrypted backups. It is not permanent erasure.

## Model integration and token budget

The owner enabled automatic capture of directly stated ideas, purchases and durable facts. Tasks are opt-in: create them only when tracking, a to-do, or follow-up is requested, not for every future intention. Independent one-time notifications use the separate [reminder domain](REMINDERS.md); legacy task reminders remain supported. Every successful write is explicitly acknowledged. `personal-memory` has its own action schema, English skill and lazily selected idea/purchase/fact reference. `conversation` handles greetings and follow-ups without misreporting an empty calendar search.

Only up to four relevant memory summaries are attached as untrusted hints, capped at 500 characters each. A model memory search returns at most five bounded previews, strips source quotes and marks truncation. Exact quotations and modifications require a full read by UUID in the current turn. Updates/archive/restore are rejected without the full current record and version. The context budget shrinks with retrieved tool data. All actual mutations still go through OperationService, executable risk policy and compare-and-swap execution.

The original request is recorded as provenance, not as an instruction file. Recognizable credential formats are rejected before chat reaches the model or a memory action enters the journal. Skill prose cannot change credentials, settings, permissions or approval requirements. Explicit do-not-save instructions block chat memory writes. Hypothetical examples, assistant suggestions and retrieved content are not new owner facts.

## Speech output

`server/voice-output.ts` uses the Google Gemini API only for owner-requested speech generation. Main assistant reasoning remains on the existing provider adapter. The fixed model is `gemini-3.8-flash-lite-tts`; default voice is Charon with warm, resonant standard Turkish delivery. Sulafat, Kore, Aoede and Puck remain selectable.

The API key is AES-GCM encrypted in the existing PostgreSQL key-value store under `voice.credentials`; it is never returned by status, placed in browser storage or supplied to AGY. The owner settings page accepts replacements over the existing authenticated/CSRF-protected transport. An enabled setup requires an explicit free-tier project attestation. The operator must keep Google billing disabled to retain the requested free-only usage; a client-side setting cannot independently verify or enforce the project's Google billing state.

The local default limit is 20 generation attempts per local calendar day, configurable from 1 to 200. A database-atomic reservation bounds concurrent requests. Identical concurrent requests share one generation; a small process-local audio cache avoids repeated calls on replay. Cache is bounded by entry count and total bytes and clears on settings changes. Failed generation attempts count conservatively. Quota, permission and invalid audio failures are visible; no provider/model fallback or automatic retry occurs. Google's actual RPM/RPD limits remain project/model-specific, not a universal 1,500 daily TTS requests.

Interactions use `store:false`, verbatim transcript input and separate speech-style metadata. Only the text the owner elects to play is submitted. Google free-tier data handling is governed by Google's terms; `store:false` controls interaction retention and does not override those terms. Responses are bounded: complete-file responses require a WAV header; streaming responses require validated PCM audio deltas and a terminal completion event. Keys are sent only in the request header, not a URL. Audio is returned from `/api/speak` with private no-store caching headers.

## Microphone input

`src/VoiceControls.tsx` records with MediaRecorder and measures actual microphone RMS through Web Audio. Silence timeout is a named 900 ms constant. Maximum duration is two minutes and maximum input size is 8 MB. Unsupported/blocked microphones and uncertain decoding produce visible messages. Tracks, timers and audio contexts are cleaned up when recording stops or the component closes.

`/api/listen` uses the existing offline faster-whisper adapter. Decoding is bounded to 120 seconds of resampled mono 16 kHz PCM before model inference, including containers with missing duration metadata. No browser Web Speech recognition service is used. The transcript populates the text field for owner inspection; sending it remains an explicit action. Starting playback stops an active recording; starting the microphone cancels playback to avoid self-transcription. Listening state reflects actual recording, not a decorative animation.

## API

Voice playback defaults to **Charon**, a male voice, with a warm, resonant conversational style. `/api/speak/stream` makes one free-tier generation request and forwards validated 24 kHz, mono, signed little-endian PCM as private NDJSON frames. Web Audio starts from the explicit click gesture and schedules incoming chunks before generation finishes. `done` is required; truncated/error streams stop playback and never enter the cache. Completed audio is cached as WAV for replay without another generation. Closing the assistant or stopping playback aborts the request and closes the audio context. This reduces time to first playback, not a promise about provider generation latency. The bounded WAV endpoint remains available for clients that need a complete file.

All endpoints retain normal owner/session checks. POST requests require the existing exact origin and CSRF token.

| Method | Path                          | Purpose                                                |
| ------ | ----------------------------- | ------------------------------------------------------ |
| GET    | `/api/memories`               | Query/type/date/archive filters, bounded keyset page   |
| GET    | `/api/memories/:id`           | Full record                                            |
| GET    | `/api/memories/:id/revisions` | Last 50 versions                                       |
| GET    | `/api/memories/:id/export`    | One portable Markdown record                           |
| POST   | `/api/operations`             | Validated memory create/update/archive/restore         |
| GET    | `/api/voice/status`           | Public-to-owner settings/quota/configured flag, no key |
| POST   | `/api/voice/settings`         | Owner voice setup and encrypted key replacement        |
| POST   | `/api/speak`                  | Bounded text to private WAV                            |
| POST   | `/api/speak/stream`           | Explicit-click streamed audio; terminal done/error     |
| POST   | `/api/listen`                 | Bounded base64 audio to an unexecuted transcript       |

## Validation and references

Tests cover typed capture, original-source retention, current-version reads, conflicts, atomic SQL revisions, replay suppression, archive/restore, credential rejection, cross-origin/unauthenticated access, encrypted key status, audio validation, single-flight cache, durable quotas, timezone behavior and microphone failure feedback. Existing calendar and Telegram suites remain part of acceptance. Real provider probes must use owner-supplied text and isolate personal data/side effects.

- PostgreSQL text search and indexes: https://www.postgresql.org/docs/17/textsearch-tables.html
- Google speech generation, Turkish support and voice characteristics: https://ai.google.dev/gemini-api/docs/speech-generation
- Google pricing: https://ai.google.dev/gemini-api/docs/pricing
- Project-specific quotas: https://ai.google.dev/gemini-api/docs/rate-limits
- Interaction storage controls: https://ai.google.dev/gemini-api/docs/interactions-overview

## Tasks, reminders and completion

Task records have taskState=open/done and an optional offset-ISO remindAt, normalized to UTC before persistence. A stated intention can be captured without inventing a notification time. A request for a notification with an ambiguous time requires clarification. memory.complete uses the normal validated version-bound operation path, marks only a task done, archives it from open retrieval and preserves immutable revisions. An explicit restore reopens it. Completed records are available with archived=true.

The scheduler reads at most 50 due unscheduled tasks per tick. A unique task-id/reminder-time key prevents duplicate delivery across text edits and restarts. Reminder jobs reread the task and skip completed, archived or rescheduled tasks. The Telegram outbox checks again before sending, so an undelivered notification is suppressed after completion. Offline overdue task reminders may arrive late; recurring routines retain their existing 15-minute missed-run policy. No model is called to deliver either kind of fixed reminder. /gorevler lists up to 20 open tasks and /rutinler lists routines without model calls.

## Explicit AI reports

ai_daily_summary and ai_weekly_summary are opt-in routine kinds; existing deterministic kinds keep their behavior. The weekly AI report covers next Monday through Sunday in the routine timezone. At execution the worker reads current primary-calendar data, removes canceled/declined events, bounds the report to 200 event titles and times, omits descriptions/attendees and masks recognized credentials. Any truncation is disclosed. A separate English read-only skill permits only a bounded message, no actions or tool calls. An optional message is a calendar-report editorial focus. Generation uses the existing provider adapter and shared model queue; no paid fallback is added. Quota/authentication/provider failure is a failed job with a notification, never a fabricated successful report. AI schedules are limited to at most hourly.

AI jobs have their own ai_report queue partition and worker loop, so slow generation does not block fixed reminders or operation processing. They still use atomic persistent claims and content/revision checks. Shutdown cancels the report request before closing the database.

## Telegram behavior

Owner-authenticated, confidently decoded voice is interpreted directly without a transcript-confirmation keyboard. Uncertain decoding still stops and asks for a clearer recording. Consequential operations retain their normal hash-bound approval. A failed/expired Telegram callback toast cannot consume an application approval. Durable receipts support retry after provider failure and show the existing operation status on repeated clicks. Legacy transcript keyboards remain usable during upgrades. The trailing app-link signature is removed; completed operation replies share the existing notification outbox key to avoid duplicate results.

## Smooth playback and local replay

The browser coalesces PCM packets, prebuffers approximately one second and schedules adjacent blocks on the audio clock. After an underrun it re-buffers instead of playing each late tiny packet separately. Completion flushes short clips immediately; a bounded idle flush drains a trailing phrase if provider completion metadata is late. Stop closes the context and settles waiting playback.

Only successfully completed streams enter a private browser RAM cache for 10 minutes (up to 8 clips and 24 MiB of encoded-string storage). The key includes voice and exact spoken text. Local replay sends no HTTP request. Canceled or truncated streams are never cached. Settings/session changes and authentication failure clear it; no localStorage, IndexedDB, service-worker cache or audio file is written. The server's bounded audio cache remains the fallback when the browser has no clip.
