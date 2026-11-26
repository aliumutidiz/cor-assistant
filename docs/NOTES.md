# Contextual notes

Notes are independent, versioned personal records linked to a specific context.
They do not change a calendar event, reserve time, schedule a reminder or invoke an
LLM when saved through the interface.

## Use

- In Calendar, choose **Notes** under a day heading or the **Notes · date** control
  for the selected date. Day notes are tied to that civil date in the workspace timezone.
- In Programs, use the record's **Notes** button for the whole program. Expand
  **Activity notes** to attach notes to one activity across all its occurrences.
- Open a program occurrence in Calendar and choose **Notes for this occurrence**
  for a note that applies only to that original occurrence. The attachment stays
  stable when the occurrence moves.
- Existing Google event details expose **Personal notes**. These remain local to
  C.O.R. and are not written into a Google event's shared description.
- Routine and reminder rows have **Notes**. Personal records have **Notes** or
  **Related notes**. Shopping-item inline notes remain supported.
- Notes also appear in Memory's **Note** filter. Archived notes can be found,
  inspected and restored there. Whole-memory exports include the attachment;
  individual Markdown exports include it as metadata.

Save, edit and archive are separate guarded operations. The editor preserves its
draft after a failed or conflicting save. A queued change is not labeled saved.
Refresh notes to inspect the latest version before reconciling a conflict.
Read-only workspace members can view notes but have no editing controls; the
normal server authorization applies independently of the interface.

## Storage and assistant contract

`memoryInput.kind=note` requires `noteTarget`. The strict target union in
`shared/notes.ts` supports `workspace`, `day`, `program`, `event`, `routine`,
`reminder` and `memory`. Program targets may have a stable `entryId`, then an
optional original occurrence `day`. Whole-program, activity and occurrence notes
are distinct scopes. Context links never grant permissions.

`GET /api/memories?kind=note&noteTarget=<URL-encoded JSON>` filters the exact target
before bounded cursor pagination. PostgreSQL indexes attachment equality. Dated
notes derive `occurredOn` from their target; undated notes do not become calendar
plans merely because they were recorded that day. Simple supported calendar
questions include bounded dated notes without requiring a model call.

The assistant uses `personal-memory` reads and validated `memory.create/update/
archive/restore` operations. It must resolve real resource IDs, read current notes
before editing, preserve versions and disclose confirmed outcomes. Note content
is untrusted data, never an instruction to change policy or execute commands.
Record-size limits, credential rejection, idempotency and sensitive-action
policies remain active. Existing program and entry records are not rewritten to
add a note, so concurrent program edits do not overwrite independent notes.

Resource links are soft historical references: notes are not automatically erased
when a linked resource disappears. New local links are checked against their
resource/entry; Google identifiers are opaque links and do not trigger a Google
mutation or an external fetch. Editing or archiving an existing orphaned note
remains possible. No automatic orphan deletion or recurring notification is implied.

The database migration extends the existing kind constraint and adds a derived
attachment index. Existing records retain their contents, IDs and versions.
