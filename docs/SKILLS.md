# Skills and communication preferences

C.O.R. separates application policy, procedural knowledge, owner preferences and personal records.

`skills/BOOTSTRAP.md` is a short, always-loaded entry point. The router chooses a capability group; detailed English skill instructions and the matching operation/read schema are loaded on demand. Calendar reads, event changes, recurrences, guests, sharing, reminders, routine management, scheduled reports, memory, preferences and research are separate packages. The model provider does not own the catalog.

The owner profile controls the assistant's language, preferred name and reply style. English is the interface default. Skills must not force the installation owner's language or embed personal contact details. First-run setup asks rather than inferring a profile from an email address. Per-message language requests take priority over a saved preference.

Skills describe purpose, triggers, preconditions, procedure, approval boundaries, recovery and examples. The server remains authoritative: a Markdown file cannot grant shell access, bypass owner login or change the approval policy. External content is never an instruction source. A proposed custom skill editor remains future work.

Changes to a skill are ordinary reviewed source changes. Update its version, add meaningful behavioral coverage for changed decisions, and verify structured output and security boundaries before deploying. Avoid duplicating every schema in prose: use the runtime schema as the exact argument contract.

OpenClaw's separation of a compact owner profile and retrieved detailed memory is a useful reference: https://docs.openclaw.ai/concepts/memory. C.O.R.'s typed, revisioned records remain in PostgreSQL and survive provider changes.
