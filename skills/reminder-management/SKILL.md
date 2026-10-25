---
name: reminder-management
version: 1.0.0
description: Manage independent and event-linked Telegram reminders without mandatory task tracking.
---

# Purpose and triggers

Version: 1.1.0

Use for explicit reminder requests, including Turkish relative times, reminder inspection, cancellation, rescheduling, and event-relative alerts. A reminder is not a task or calendar entry. Recurring fixed messages belong to routine-management; creating an event with an alert belongs to event-management.

# Preconditions and authority

AUTHORITATIVE_CONTEXT supplies the current UTC instant, owner timezone, delivery-channel availability, and current reminders with versions. Resolve “in five hours” from that instant using elapsed time. Resolve “tomorrow at seven” in the owner timezone. Ask when AM/PM, event identity, or wording is materially ambiguous. Never infer reminder deadlines from old conversation timestamps. Do not promise Telegram delivery when its connection is unavailable.

## Procedure

- Create: `{"kind":"reminder.create","reminder":{"title":"Call the repair shop","message":"Call the repair shop.","remindAt":"<absolute ISO timestamp with offset>","enabled":true}}`.
- For event-relative reminders, omit remindAt and provide `event:{calendarId,eventId,minutesBefore}`. Read events first and use an exact returned ID. A five-hour lead time is 300 minutes. Recurring series links follow future occurrences; an instance ID targets only that occurrence. All-day events use midnight at the event timezone; clarify if the owner expects a different reference time.
- List/inspect: `read:{kind:"reminders"}` or include `reminderId`. State whether scheduled, paused, delivered, or canceled. Never list canceled entries as pending.
- Update: `reminder.update` requires reminderId, current version, and the complete replacement reminder. Preserve the message and event link unless the owner changed them. Pause/resume by setting enabled false/true. For absolute reminders, provide remindAt; for linked reminders, provide event, never both.
- Cancel: `reminder.cancel` requires reminderId and current version. This stops future delivery and preserves history. Do not delete the linked calendar event.

# Workflow and approvals

Read authoritative reminder context before changing or canceling. If multiple reminders match, ask which one. These owner-only notification changes are normal validated operations. Calendar deletion, invitations, bulk changes, and sharing retain their separate approval policies. Emit one action OR one read per response. The server confirms execution; do not claim completion before an operation succeeds.

## Failure and recovery

Stale versions require a fresh read. Past deadlines are rejected; ask for a future time. Missing calendar events cancel linked reminders. Temporary calendar failures defer verification and delivery; never report absence as success. Uncertain Telegram sends must be reconciled rather than blindly duplicated. No LLM is called when a reminder becomes due.

# Examples

- “Bana 5 saat sonra çamaşırları hatırlat”: independent reminder at now plus five hours; no task, no calendar event.
- “Yarınki toplantıdan 5 saat önce haber ver”: read tomorrow's events, identify the meeting, then create an event link with minutesBefore 300.
- “O hatırlatmayı bir saat ertele”: use the current matching reminder version and change its time; do not create a duplicate.
- “Bunu artık hatırlatma”: cancel the exact reminder, leaving its source event unchanged.
