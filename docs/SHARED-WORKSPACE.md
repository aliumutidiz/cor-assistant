# Shared personal workspace

C.O.R. still has one owner and one set of connected services. **Settings → Shared access** lets the owner allow up to ten verified Google accounts. This is a trusted shared workspace, not separate tenant storage or a public registration system. Invitations include current personal records, calendar data, routines, activity and shared chat history. There is no per-record privacy partition in this version. Only invite someone who should see that information.

## Roles

| Capability                                                                          | Viewer | Editor | Owner |
| ----------------------------------------------------------------------------------- | ------ | ------ | ----- |
| Read calendar, programs, routines, reminders, memory and chat history               | Yes    | Yes    | Yes   |
| Export shared records/history                                                       | Yes    | Yes    | Yes   |
| Normal planning edits and assistant chat                                            | No     | Yes    | Yes   |
| Manage Google/Telegram/model connections and secrets                                | No     | No     | Yes   |
| Change owner profile/preferences, invite/revoke accounts, reset/delete conversation | No     | No     | Yes   |
| Approve sensitive operations                                                        | No     | No     | Yes   |

Add the person's exact Google account email and select **View only** or **View and edit**. No email is sent automatically. Share the normal site URL; they sign in with their own Google account. Their basic identity login does not connect their Calendar or expose the owner's Google refresh token. An existing Cloudflare Access policy must also admit the account if that authentication mode is used.

Revocation removes access on subsequent requests and ends existing progress streams on their next check (up to three seconds). Role changes rotate the invitation ID, invalidating old sessions and pending writes. Google subject binding prevents substituting a different account under an existing invited identity. Already downloaded information and operations already executing cannot be recalled.

## Assistant and audit boundaries

The visible conversation archive is shared and guest exchanges are labelled. Each invited account uses a separate model conversation scope and clarification state. The owner's contextual history excludes guest exchanges; a guest's contextual history includes their own exchanges. Shared planning and records remain available to authorized editors. The model receives the requester role, without receiving the guest's email as an instruction.

The request identity is set by verified server authentication, never chat text or a submitted body. Durable chat jobs and operations retain the actor, check editing permission again before work starts, and revalidate at operation submission. Activity records identify the initiating account. Pending sensitive operations still require the owner. Exact-content approvals, versions and idempotency remain in force. Revoked jobs cannot start new edits. Unknown external writes are never replayed automatically.

Owner-only connection and access routes are denied by default for invited users; new API routes require an explicit guest permission decision. Telegram remains restricted to the existing owner/group configuration. This feature does not add a hosted identity service or GitHub Actions.

Invitations and sessions are runtime database state. They are excluded from personal-memory exports and must not be committed to Git. Existing encrypted installation backups cover the database.
