# Durable personal context and typed resources

Status: implementation baseline, October 2026. This is an application memory system, not model fine-tuning. Changing the model does not erase PostgreSQL records, conversations, revisions or English skills.

## Design decisions and research

[OpenClaw's memory documentation](https://docs.openclaw.ai/concepts/memory) distinguishes a compact user model, durable facts and more detailed episodic notes. C.O.R. adopts that separation of responsibilities, using validated PostgreSQL records instead of writable instruction files. Profile statements remain owner evidence; they cannot grant permissions. We deliberately do not copy autonomous memory consolidation or additional housekeeping model calls.

[SearXNG's documented Search API](https://docs.searxng.org/dev/search_api.html) provides structured JSON search when that format is enabled. It supplies the optional search adapter, separate from the model provider. [Its container installation documentation](https://docs.searxng.org/admin/installation-docker.html) describes the upstream image. An operator must select a reviewed image version/digest; the repository does not silently download an unpinned image.

## Canonical state

- `profile`: individual owner-stated identity, preference, priority or personal boundary; optional last valid date. Each statement is short (up to 1,000 characters). It is inspectable, editable, reversible and versioned like other records. Revise an existing preference after reading it; do not accumulate contradictory active directives.
- `fact`, `idea`, `purchase`: durable personal evidence with original body, summary, source text/channel and recording time. Unknown dates/prices stay unknown.
- `task`: only explicitly requested task tracking. Casual intentions do not become tasks.
- `program`: reusable local-time weekly/monthly entries, effective period and exclusion dates. It neither creates Google events nor schedules notifications. An occurrence reader performs date arithmetic deterministically. Weekly days are ISO 1–7; nonexistent monthly days are skipped. Overnight sessions must be split. Up to 100 entries, 93 days per occurrence window.
- `shopping_list`: stable item IDs, name, owner-supplied quantity/unit text, category, note and checked state. A checked item does not fabricate a purchase transaction. Up to 200 items.

Each typed payload must match its record kind. Total serialized record size is bounded to 40,000 UTF-8 bytes. Updates supply the current version and preserve unrelated content. Server-generated provenance and immutable revisions remain independent of model output. Archive excludes a record from active retrieval, but does not promise deletion of chat, historical revisions or backups.

## Context construction

1. Turkish-aware normalization removes accents and common request filler from lexical terms.
2. PostgreSQL GIN indexes retrieve weighted lexical candidates across the full personal archive, not just the latest records. A deterministic reranker prioritizes title/tags over incidental body matches. The in-memory demo implements the equivalent bounded selection.
3. At most six automatic memory hints fit within 4,000 serialized characters. Hints are explicitly partial and untrusted. Exact answers and all mutations require full source reads.
4. Non-expired profile statements fit within a separate 3,000-character serialized budget. Whole statements are selected without truncating their meaning. Omitted/expired statements remain stored; a partial marker instructs the model to search when needed.
5. Conversation storage is separate. The latest 50 messages and up to eight indexed older matches are candidates for a bounded working window. Search spans the full conversation archive. No extra model call creates a summary for every message.
6. Structured list/program content is represented by counts in search previews; it is loaded only when the owner actually needs that record. A complete read carries the current version before an update.

These are character/byte budgets, not exact tokenizer counts. Lexical retrieval is intentionally inexpensive and has limits: synonyms, paraphrases and absent terms may be missed. There is no embedding model, vector database, background dreaming or guarantee that a weak model cannot make mistakes. Add an optional local semantic retriever only after measured recall failures justify its RAM and latency costs. Preserve the same canonical records and provenance if it is added.

## Chat continuity

Web requests have durable UUIDs. The browser stores only a pending UUID, scoped to the signed-in owner, never message contents or event data in localStorage. Reloading polls that request; it does not submit another mutation. Success reloads the canonical archive. Telegram/web provenance and recording time are shown on archived messages. Suggested messages are labeled as suggestions and are sent only on click. Stopping the browser wait does not cancel already accepted server work.

Calendar range data stays in an App-instance memory cache (16 ranges, 60-second freshness). Identical reads are coalesced; the next range is prefetched after a successful foreground read. Mutations invalidate the cache. Failed background refreshes retain cached data with a visible error. Login expiry clears the cache; no service worker or browser persistent storage stores calendar contents.

## Portability and recovery

`GET /api/brain/export` is owner-authenticated and exports current active/archived personal records with format and schema version. It excludes credentials, conversations and revisions and is not a transactionally consistent database backup. Export streams pages of 50 records to bound memory use; concurrent edits can affect later pages. Use database backups for a consistent full recovery point. Selected-record Markdown exports remain available. Use the existing encrypted database backup/restore workflow for full disaster recovery. Automatic destructive imports are not exposed.

## Search trust boundary

Research is a read-only skill with no mutation capability. It can make one search and read a returned public source (or an exact public URL supplied by the owner). Citations must identify actual sources, with snippet-only limitations disclosed. No CLI shell/network capability is enabled.

The owner chooses the SearXNG origin in Settings. An exact loopback service is allowed for the trusted search adapter only. Arbitrary page reads reject private/reserved IPv4/IPv6, credentials, unusual ports, mixed DNS answers, unsafe redirect destinations and large/non-text responses. Verified DNS answers are pinned to the actual connection. Search results are at most six excerpts; pages are bounded to 512 KB transfer and 6,000 characters of extracted text. This text reader does not execute JavaScript, authenticate to websites or parse PDFs.

Search terms reach the configured search service and upstream engines. Owner profile and personal-memory hints are excluded from research prompts. External content cannot become trusted memory or instructions. Research settings and Telegram credentials can only be changed through authenticated, CSRF-protected owner routes, never through chat actions.

## Connection configuration

Telegram token, numeric owner, allowed groups and notification destination are owner-editable. The token is AES-256-GCM encrypted with the installation key and never returned by the API. An empty replacement token preserves the current credential. Existing environment configuration remains the fallback until a UI configuration is saved. Changes restart the Telegram loops within approximately five seconds. Even in allowed groups, only the numeric owner may issue commands. Removed destinations are checked again before delivery.

One bot identity belongs to an installation. Rotating its token is supported; replacing it with a different bot ID requires a queue/approval migration and is deliberately rejected. Group replies return to their originating allowed group; scheduled notifications use the selected notification destination. Group configuration does not authorize other group participants to command the assistant.
