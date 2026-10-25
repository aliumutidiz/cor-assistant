# C.O.R. evolution: an adaptable personal assistant

Research date: 2026-10-23. Status: proposed architecture, not implemented functionality.

## Product direction

The owner should describe changing priorities in conversation rather than select a permanent list of three data sources. C.O.R. should remember those priorities, explain what it recorded, and apply the active rules when a routine executes. New interests must not require new routine types. New external systems still require an implemented connector and owner authorization.

Example: “Job application replies matter this month. Check them in the morning and tell me when something needs a response.” This becomes a dated attention rule, referencing an authorized email connection. The existing morning routine reads that rule at execution time. “This is no longer important” deactivates it. A disconnected source produces a clear connection requirement, never a fabricated empty result.

## Current foundation and gap

C.O.R. already has persistent scheduling, fixed reminders, read-only AI calendar reports, Telegram delivery, personal records and tasks, guarded operations, and a provider adapter. Current AI routine types are predefined calendar reports; they are not a general agent workflow. Gmail, document management, weather, news, and home automation are proposed connectors, not existing capabilities.

Preserve the PostgreSQL queue, operation approvals, idempotency, secret isolation, and separate report worker. Extend the existing system instead of replacing it with another assistant framework.

## Research findings

These findings come from official repositories and documentation. They are architectural references, not installation results, benchmarks, or security audits.

| Reference                                                                                                               | Observed pattern                                                                                | Application to C.O.R.                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [Hermes scheduled tasks](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)                           | Conversational job management, skill attachments, agent and no-agent execution, event triggers. | A shared routine contract with explicit execution modes. Prevent scheduled agents from recursively creating more schedules.    |
| [Huginn](https://github.com/huginn/huginn)                                                                              | Agents collect events and pass them through monitoring and notification workflows.              | Detect relevant changes with deterministic checks before spending inference on interpretation.                                 |
| [OpenClaw](https://github.com/openclaw/openclaw)                                                                        | A central gateway coordinates channels, tools, and assistant capabilities.                      | Keep Telegram, web, and future mobile interfaces independent from the reasoning provider.                                      |
| [Khoj automations](https://docs.khoj.dev/features/automations/)                                                         | Scheduled queries and recurring research/news outputs.                                          | Personal briefings can combine knowledge retrieval with timely research. Delivery remains C.O.R.'s existing Telegram outbox.   |
| [n8n workflow tool](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolworkflow/) | A complete workflow can be exposed as an agent tool.                                            | Expose reusable, typed capabilities rather than asking the model to reconstruct every integration step.                        |
| [Home Assistant triggers](https://www.home-assistant.io/docs/automation/trigger/)                                       | Time, state, and event triggers initiate automations.                                           | Add event-driven routines alongside schedules; keep trigger, condition, and action distinct.                                   |
| [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)                                | Checkpoints preserve execution state across pauses and failures.                                | Persist workflow steps and resume approvals without blindly replaying external writes. No framework migration is required.     |
| [Letta memory blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks)                                               | Bounded persistent context can represent stable user information.                               | Keep a small profile and active priorities in context; retrieve historical records only when needed.                           |
| [Paperless-ngx](https://docs.paperless-ngx.com/usage/)                                                                  | Document ingestion, OCR, metadata, and workflows support a personal document archive.           | Consider a document connector for receipts, invoices, warranties, and renewal dates instead of building a full archive system. |

## Proposed domains

### Profile and attention rules

Separate stable preferences, historical memories, tasks, and active monitoring instructions. A free-form memory alone is not an executable monitoring rule.

An attention rule needs an ID, version, owner instruction/source, topic, priority, active state, effective dates, source bindings, filters, notification condition, and last review time. Store relative-date interpretations with the resolved Europe/Istanbul dates. Ask about material ambiguities instead of guessing sensitive filters or deadlines.

The assistant reports what changed: what it will watch, until when, and how it will notify. The owner can inspect, edit, pause, or remove rules from both chat and the interface. Inferred interests may become suggestions, but must not silently become consequential standing instructions.

### Capability registry

Each tool declares a strict input/output schema, required connection and scope, read/write classification, approval policy, timeout, retry policy, and idempotency behavior. Credentials stay server-side. The registry is independent of skills and model providers.

The model can choose available tools within owner-authorized bounds. A preference cannot grant OAuth scopes, enable arbitrary shell access, rewrite security policy, or connect a new account. Email and document contents are evidence, never authority to issue tool instructions.

### Routine definition v2

A routine should store:

- A natural-language goal and a structured, versioned definition.
- Trigger: schedule, one-shot time, supported external event, or manual execution.
- Conditions, timezone, enabled state, next run, and missed-run policy.
- Execution mode, permitted capabilities, selected skill versions, and attention-rule references.
- Delivery target, quiet hours, change-only or always-send behavior, and cooldown.
- Limits for tool steps, model calls, runtime, and retries.

Support three modes:

1. **Deterministic:** fixed reminders, upcoming-event checks, thresholds, and template messages. No LLM at execution time.
2. **Summarize:** deterministic collection followed by one bounded model summary when needed.
3. **Bounded agent:** the model chooses additional permitted reads and guarded actions toward a goal, with durable steps and explicit limits.

Existing routine types become compatibility templates. Do not discard current schedules or change their enabled state during migration. Calculate and show the next run after every schedule edit. Overlap behavior must be explicit; default to one active run per routine.

### Durable execution and delivery

Persist run identity, routine version, policy version, plan, steps, source timestamps, approvals, and outcomes. Use existing guarded operations for writes. A process restart resumes known work; an ambiguous external write requires reconciliation rather than an unconditional retry. Database transactions cannot guarantee exactly-once effects in unrelated remote services.

A scheduled agent must not recursively create or expand schedules. It can report a proposed change for the owner to accept. Owner-requested routine creation in chat remains supported.

Notifications distinguish complete, partial, failed, and awaiting-approval outcomes. An unavailable mailbox is not “no important email.” Reports carry source references and collection times. Deduplicate unchanged alerts, support snooze/complete actions, and respect quiet hours unless the owner explicitly defines an exception.

## Gmail integration

Calendar authorization does not grant Gmail access. Add a separate incremental consent step, starting with read-only access. Sending or modifying mail remains a later, separately authorized capability. Google documents the scope differences in [Gmail authorization scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

Use bounded initial retrieval, local cache, and incremental history synchronization. Expired history requires resynchronization; see [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync). Query by sender, labels, and dates, fetching message bodies only when relevant. App filters do not narrow the underlying OAuth scope to a single label. Resolve local date boundaries to epoch timestamps because Gmail date-query interpretation can otherwise differ from Istanbul time; see [Gmail filtering](https://developers.google.com/workspace/gmail/api/guides/filtering).

Mail bodies and attachments can contain prompt injection or confidential data. Apply owner-selected model disclosure preferences and minimize transmitted content. Prefer metadata and snippets before full bodies. Do not automatically execute links, attachments, unsubscribe requests, or instructions found inside messages.

## High-value expansion areas

1. Personalized morning brief: today's commitments, overdue tasks, waiting-for items, and relevant email changes. Evening review can capture unfinished work and tomorrow's preparation.
2. Follow-through: projects, next actions, waiting-for tracking, and weekly reviews. Completing a task preserves its history and suppresses future reminders.
3. Documents: searchable receipts, invoices, and warranties with original-source links. Dates extracted by OCR need verification when consequential; never invent an expiry date.
4. Topic monitoring: selected RSS feeds, release notes, or supported price sources, with change detection and digest delivery. Public-web connectors need URL validation and private-network protections.
5. Home server: typed checks for disk space, backup age, and named service health. Deterministic checks need no model. Any recovery action is limited to explicitly delegated services.
6. Smart home: connect Home Assistant if the owner uses compatible devices, rather than rebuilding device orchestration.
7. Mobile capture: Android share targets, voice, photos, and notification actions. Location remains opt-in and purpose-bound.

These capabilities are optional modules. Their availability, service quotas, and possible external costs must be visible. No paid reasoning provider should be introduced implicitly.

## Token and latency policy

Collect data deterministically, reuse incremental caches, detect changes, then decide whether inference adds value. Pass only relevant records and skills. Fixed notifications remain model-free. A scheduled brief may need inference even without a source change when the owner requested a daily interpretation; change-only monitors should normally remain silent.

Use bounded profile context and targeted history retrieval. Avoid a continuously running model heartbeat, a separate agent per notification, and a vector database until retrieval measurements justify one. Keep scheduled reports separate from urgent reminders and interactive requests. Surface expired model sessions and queue congestion honestly.

## Delivery sequence

1. Add structured attention rules, a capability catalog, and routine v2 contracts. Extend routine UI to show goal, allowed tools, current priorities, next run, and execution history.
2. Add read-only Gmail consent and incremental collection. Deliver a personalized morning brief using calendar, tasks, attention rules, and authorized mail.
3. Add event/change triggers and durable bounded-agent execution with resumable approval steps and actionable Telegram notifications.
4. Add project follow-through, document and server connectors, and mobile capture according to actual use.

## Acceptance scenarios

- A temporary priority changes an existing morning routine without editing its schedule; expiration stops future monitoring.
- A missing Gmail connection is clearly reported and cannot be activated through conversational memory alone.
- A fixed reminder makes zero model calls; unchanged change-only monitoring also avoids inference.
- The agent can manage routines through validated tools while a scheduled run cannot spawn recursive jobs.
- An email asking the assistant to reveal secrets or change rules is treated as untrusted content.
- Restarting after a tool result or approval preserves progress and does not duplicate an event or notification.
- Partial source failure yields a partial report with the failed source identified.
- Completing or snoozing a task updates future delivery and preserves history.
- Existing routines survive migration with their timezone, enabled state, and next-run semantics intact.
- Disabling a connection prevents later collection and cancels or blocks dependent steps safely.
