# Programs and timetables

Use **Programs → Add program** for classes, recurring appointments or a reusable personal timetable. This is separate from routines: a program describes occupied time, while a routine schedules execution or a notification.

Each program contains named activities with weekly ISO weekdays or monthly dates, start/end times and an explicit IANA timezone. It supports effective start/end dates, skipped dates, pause/resume and an **Include in availability** switch. A monthly date absent from a month is skipped. Overnight activities must be split into two entries. Saved programs remain revisioned personal-memory records; no duplicate Google events or automatic notifications are created.

The form accepts optional notes; the schedule itself is sufficient. Programs are also accessible through Memory. Memory offers list/card layouts, type and search filters, separate active/completed/archive views, source text and version history.

## Assistant availability

An assistant calendar event or freebusy read automatically adds program availability for the same exact interval. Enabled, non-archived programs are expanded deterministically in their own timezones and intersected with the requested interval. Only `blocksTime !== false` occupies time. Daily/weekly reporting and direct basic day/week calendar summaries also include program evidence.

The assistant must combine calendar and program evidence before saying the owner is free. A read of the primary calendar is not a check of every other calendar in the account. Errors, source omissions and partial results must be disclosed. Creation of a program does not itself run a conflict check.

Each request spans at most 93 days and inspects at most 100 active-source records/500 matching occurrences. Limits are explicit partial results, never an empty/free verdict. Missing daylight-saving wall times are reported as unresolved. Repeated wall times conservatively span the earliest possible start to the latest possible end, with an ambiguity flag.

## Tracked task completion

Reporting that a tracked task is done is different from asking to remove it. A completion uses `memory.complete`, records `taskState=done`, preserves history and suppresses its pending reminders. An explicit removal may archive the record without claiming the work was completed.

A model-proposed ID/version already present in visible memory hints or search results can trigger a server-side full-record read. Completion/archive/restore still validate the current version before execution. Full updates are regenerated after that read to preserve omitted fields. Unknown IDs are rejected; conflicting matches require clarification. Common numeric shorthand such as `7.5k` is expanded for memory retrieval, and trusted repository full-text matches are not discarded merely because a second literal scorer lacks the same stemming.
