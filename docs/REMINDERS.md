# Independent and event-linked reminders

Reminders are separate from calendar events and personal-memory tasks. A one-time notification does not create a to-do. Recurring fixed messages still use deterministic routines. No model is called at notification time.

## Contracts and tools

`shared/reminders.ts` defines strict `reminder.create`, `reminder.update`, and `reminder.cancel` operations. Updates and cancellations require the current UUID and version. A reminder contains a title, message, enabled state, and either an absolute offset-ISO `remindAt` or an event reference with `calendarId`, `eventId`, and `minutesBefore`. Absolute deadlines are normalized to UTC. Enabled single reminders must have a future deadline when created or rescheduled.

`GET /api/reminders` is owner-only. Writes use the existing CSRF-protected, idempotent operation endpoint. The English reminder-management skill exposes the lifecycle to the assistant, including pause, resume, inspection, and cancellation. Reminder changes do not delete source events. Canceling preserves history and excludes the reminder from the active list. The Telegram `/hatirlatmalar` command lists up to 30 pending reminders without inference.

Calendar create/update operations can include `telegramReminderMinutes` beside the Google event object. Omission preserves existing links, a number creates or updates a link, and null cancels active direct links to that event. Native Google notifications remain in `event.reminders` and are configured independently. Existing native notification settings are preserved unless explicitly edited.

## Persistence and delivery

The PostgreSQL `reminders` table stores versioned current state. The operation journal preserves changes. A unique queue key includes reminder ID, version, and resolved deadline. The worker prepares a deterministic notification; the Telegram outbox rechecks the current reminder immediately before sending. Cancellation, pause, and rescheduling suppress a previously prepared stale message. Acknowledged sends transition single reminders to delivered. Recurring links advance to a later occurrence.

Calendar links are refreshed in a separate guarded asynchronous loop, normally at most once per minute per active link, so their periodic lookups do not block ordinary reminder scheduling. Due linked reminders are verified again before preparing and delivering a message. Temporary source failures defer delivery. Deleted events cancel the link. Reading a recurring master and expanded occurrences follows Google's [recurring-event model](https://developers.google.com/workspace/calendar/api/guides/recurringevents). The occurrence search uses a rolling 93-day forward window; a series with no matching occurrence remains pending until the window reaches it. All-day links use midnight in the event timezone, falling back to Europe/Istanbul when no timezone is available.

Independent overdue notifications are caught up after downtime. A notification is not guaranteed to arrive at an exact second when the server, network, or Telegram is unavailable. Recurring routines retain their separate missed-run policy. Unknown external send outcomes are not blindly retried. A visible reminder error tells the owner to check Telegram before rescheduling. Interrupted read-only preparation can be recovered safely; ambiguous actual sends retain the conservative outbox policy.

Calendar mutation and local reminder creation are not one cross-service transaction. If a calendar write succeeds and subsequent reminder persistence fails, the operation records a partial/unknown result and tells the owner to check the reminder rather than recreate the event.

## Interface

The Hatırlatmalar workspace provides active/history views, direct creation, relative-time presets, editing, pause/resume, and cancellation. Linked reminders expose their lead time instead of a detached absolute deadline. The calendar editor separates Telegram and Google notification controls, offers recurrence presets, and loads the actual master before editing a whole series. Read-only calendars cannot be saved through the editor.

Calendar navigation retains full-day views. Month view includes weekdays and muted adjacent-month dates. Period search switches to agenda view; errors and loading states are explicit, and out-of-order fetches cannot overwrite a newer request. Creating an event uses the selected date. ICS export includes fetched occurrences for the visible period, with exclusive all-day ends, escaped text, and UTF-8 line folding. It is an export, not a live subscription or the entire unbounded recurrence series.

## Verification

Tests cover deterministic delivery, worker and database restart, cancellation of queued delivery, pause/reschedule, optimistic concurrency, external calendar edits and deletion, temporary failures, recurring and zero-minute alerts, uncertain-send deduplication, credential rejection, and the assistant's separate reminder contract. Browser tests cover the independent lifecycle, mobile fit, chosen-date creation, native versus Telegram alerts, and recurrence presets.
