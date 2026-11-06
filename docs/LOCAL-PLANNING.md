# Local planning

C.O.R. projects Google Calendar events, personal programs, independent reminders and enabled routine runs into a single calendar. All source types are visible by default and can be hidden with calendar layer filters. Local items retain their source identity and never become Google events automatically. Click an item to change an occurrence or open its management page. Today combines the primary Google calendar with local planning and a separate list of open tasks; it does not assign times to tasks automatically.

## Cycles

Program entries support weekly, monthly and `cycle` recurrence. A cycle has a local anchor date, an active-day count and a rest-day count. For example, one active day and one rest day means alternate calendar days continuously across week, month and daylight-saving boundaries. No occurrences are generated before the anchor. Rest days do not block availability. Change the anchor to shift the whole cycle; skipping or moving one occurrence never shifts the base pattern. Existing weekly/monthly records remain compatible without migration.

Each occurrence has a stable identity: program ID, entry ID and original local date. Versioned `memory.update` operations preserve validation, audit history and concurrency control. An optional exception marks it done, skips it, or moves it to another local date and optionally a different start/end time. Exceptions can be restored from the program editor. A program can be paused indefinitely or over an inclusive vacation interval. Disabled, archived, excluded and paused occurrences are not shown as busy.

## Notifications

Each program entry can opt into Telegram reminders, from the start time to 1440 minutes before. Telegram must be configured in Settings. Schedule expansion, occurrence changes, fixed reminders and notification delivery do not call an LLM. AI reports remain separate routine types.

The worker checks due program notifications every 30 seconds. PostgreSQL unique job keys prevent duplicate preparation across restarts/workers. The current source is checked before preparing the message and again immediately before Telegram dispatch. Completed, skipped, moved, archived or paused occurrences suppress obsolete messages. Unrelated program edits do not cancel an unchanged occurrence.

Optional program quiet hours suppress notifications rather than reschedule them. Start and end are local hours; an equal pair means no quiet interval. Notifications up to 15 minutes late can be recovered; older notifications are skipped to avoid a flood after a long outage. Telegram delivery has the same uncertain-outcome limitations as existing outgoing messages: a lost acknowledgement is not proof that nothing was delivered.

## Projection contract

Authenticated `GET /api/planner?from=<offset timestamp>&to=<offset timestamp>` accepts a half-open interval up to 93 days. It returns `items`, `partial` and `unresolved`. Items include `source`, `sourceId`, stable `id`, `summary`, `start`, `end` and `calendarId=cor-local`; program items also include entry identity and original day. This endpoint is read-only and contains no secrets. Google events are fetched separately so a Google outage does not hide local commitments.

Expansion is bounded to 100 program records, 500 program occurrences and 1500 total local items per query. Results explicitly flag truncation and unresolved daylight-saving wall times. Partial data cannot prove availability. Use a shorter window for a dense calendar. Today reports incomplete sources rather than claiming an empty day.
