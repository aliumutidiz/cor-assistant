# Conversation controls

Open **Conversation** above the assistant, on either the full page or the sidebar.

- **New chat** starts with empty visible messages and fresh model context. Previous conversations remain in Saved history.
- **Reset context** keeps the visible conversation but excludes previous messages from subsequent model requests.
- **Saved history** opens the local archive. Search returns up to eight relevant matches, without a model call; unfiltered history is paginated in groups of 50.
- **Forget this exchange** removes the selected user/assistant pair from the local archive and replaces cached replies with a removal marker. The provider conversation key changes so subsequent requests cannot resume the old context. Remaining eligible messages can still provide context. Older migrated `legacy:` entries cannot be individually forgotten because their original pairing is not reliable; use explicit full archive deletion when appropriate.
- **Delete local history** removes all local chat messages after confirmation. It preserves calendar records, routines, saved personal memory and operation/audit records.
- **Export Markdown / JSON** downloads the latest 500 stored messages. An export at that limit explicitly warns that older records may exist. JSON includes timestamps and metadata.
- **Copy** copies a reply as text/Markdown. Clipboard failures are visible.

A draft survives a page reload in the same browser tab for up to 24 hours. It is scoped to the signed-in owner, cleared after sending/sign-out, and stored in session storage rather than persistent local storage. Recognized connection credentials are excluded. This is convenience recovery, not a password vault; do not put secrets in chat. Closing the browser tab may discard the draft.

## Scope and safety

C.O.R. is a single-owner application. Context controls affect the owner's web and Telegram conversation, not only the tab where the button was clicked. A pending assistant or incoming Telegram job prevents context changes until it finishes. Optimistic versions reject competing changes; submitted web jobs capture their context identifier and stale jobs are rejected before executing assistant actions.

The database remains the source of truth. Context watermarks exclude earlier messages from recent-history retrieval and indexed recall. A context identifier is included in native provider conversation keys and clarification keys. Resetting does not require deleting remote provider files or logging out of AGY.

Local forgetting does **not** erase Telegram messages, provider-side conversation history, backups, saved memory items or the operation journal. Review the separate Memory screen to edit or archive stored personal facts. This feature is not a complete personal-data erasure request. No model call is required for these controls.

PostgreSQL applies state changes, selected message removal, cached reply tombstones and completed request payload scrubbing in one statement. Idempotency metadata is retained so retrying a removed request does not repeat its original action. The in-memory demo provides matching control semantics but is disposable.

## Timeline reliability

History pages use chronological (created_at, id) ordering and an index-backed cursor. The cursor remains a message ID but is resolved to its timestamp for pagination; insertion order alone cannot move an imported older message below newer conversation.

The session advertises chatSync. The browser refreshes an authenticated snapshot every 15 seconds while visible and on focus/visibility changes. Snapshot context versions prevent stale resets from overwriting a newer conversation. Exchange IDs deduplicate local pending messages against stored replies. Reading earlier history preserves the scroll anchor.

Generation records the user message before calling the model. Terminal web failures are archived with their actual error result. The migration can recover eligible failed web requests still present in the durable journal, while excluding removal tombstones, scrubbed payloads, sensitive content and requests from a different current context. This cannot reconstruct unrecorded content or provider/Telegram-only messages that were never received.
