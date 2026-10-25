# AGY production verification gate

Status: **CONSOLE ADAPTER VERIFIED; OPERATOR-ACCEPTED UNSUPPORTED INTEGRATION**

Live activation: the isolated broker and application socket adapter are enabled on
Linux. A full `AssistantService` routing + skill response for the approved real
"deneme" message returned a Turkish greeting using `calendar-read`; calendar reads
and mutations were explicitly blocked in this test and no action was applied.
Routing reported 7,952 input/16 output tokens; the skill response reported 9,045
input/37 output tokens. The broker starts at boot, uses Flash Low and explicitly
rejects paid-credit fallback. Web/Telegram user interaction is the next check.

## Console adapter decision and checks — 2026-10-20

The owner explicitly chose console input/output after being shown Google's consumer
wrapper restriction. This is an operator decision to continue an unsupported
integration, **not Google approval**; the vendor policy finding below remains valid.
The existing approval-evidence configuration records that distinction. Technical
security checks must still pass before activation.

A fresh restricted Linux session listed Flash Low/Medium/High successfully. The
new Unix-socket broker runs as `cor-agent`, accepts only the `cor` UID using peer
credentials, and sends prompt content through stdin rather than process arguments.
It fixes the executable, model, low effort, deny policy and bounded timeout; callers
cannot supply environment variables, commands, paths or privilege flags. Application
credentials, database paths, backups and Docker are inaccessible in its real mount
namespace; no-new-privileges was verified. The broker aborts model built-in tool
results; the terminal `finish` step is only a protocol completion marker.

Real console test: Turkish greeting returned structured output successfully with
Flash Low (15,607 input tokens, 37 output tokens). A separate disposable canary
probe returned SUCCESS and explicit user-configured-deny errors for file reads and
terminal writes; the canary was not exposed and no requested file was created.
No actual application secret was used. This resolves the earlier ambiguous
tool-denial evidence for those two tools, not every possible tool or escape.

128 unit/security tests passed (two external PostgreSQL cases skipped), including
seven real local-socket transport tests. Production build passed. The English
bootstrap/skill transmission was explicitly approved by the owner. The actual
"deneme" message returned a Turkish greeting with `action:null` and `read:null`
through the broker (8,974 input tokens, 29 output tokens), without calendar data
or application secrets. Live application activation is recorded separately. Reboot
survival and actual quota-exhaustion behavior remain untested.

The original adapter retained four truncated messages. This was replaced by the
persistent archive and larger selected context described in `AGY-MANAGEMENT.md`.
CLI calls receive bounded context through stdin and start fresh
to avoid carrying obsolete tool results or incompatible skill schemas between
requests. This preserves conversational context at application level, not an
unbounded CLI conversation. Routing/read steps can still require several calls;
CLI-reported input overhead is material and is not claimed to be zero-cost quota use.

## Policy recheck — 2026-10-19

The current official [FAQ](https://www.antigravity.google/docs/faq#can-i-use-antigravity-cli-headless-mode-in-third-party-coding-agents-or-automate-account-switching) explicitly distinguishes direct scripting/CI from wrapping `agy` in third-party applications, which it says is not supported under consumer plans. C.O.R.'s proposed subprocess integration is a custom application wrapper; this is our interpretation of the documented boundary, not an authorization from Google.

An October 7 reply in the [Google AI Developers forum](https://discuss.ai.google.dev/t/can-a-local-ai-coordinator-launch-the-official-antigravity-cli-with-subscription-sign-in/186246) describes personal CLI subprocess use as permitted, but subsequent replies point out the conflict with the FAQ. Do not treat that earlier reply as sufficient release evidence while the published FAQ expressly excludes application wrappers. Obtain a clarification explicitly covering C.O.R. and consumer subscription authentication before enabling it.

The official CLI was subsequently installed from Google's documented PowerShell installer, which verified its downloaded binary against the release manifest SHA-512 checksum. Version `1.4.2` and `--help` succeeded on Windows. The install used `--skip-aliases --skip-path`; the executable is at `%LOCALAPPDATA%\agy\bin\agy.exe`. No authentication was attempted, no credentials were extracted, and no release gates were changed. Local Google Calendar OAuth and deterministic routines remain independent of this provider. Telegram notification setup can proceed without an LLM; free-form chat still requires an eligible provider.

For a standalone interactive login, run `./scripts/agy-login.ps1` in PowerShell. It launches the official CLI in a neutral temporary directory outside the application workspace. This directory choice does not provide OS isolation. Complete the normal browser sign-in yourself, then use the CLI's model/usage interface to check actual account eligibility. Do not confuse CLI login with Calendar OAuth consent, or mark Linux/isolation/model tests complete based on Windows login.

### Standalone Windows smoke test

After the user completed interactive sign-in, `agy models` succeeded. The account returned `gemini-3.8-flash-low`, `gemini-3.8-flash-medium` and `gemini-3.8-flash-high`, among other models. A single non-personal structured-output test with Flash Low, low effort, sandbox and a 45-second CLI timeout returned `status=SUCCESS` and `structured_output={"ok":true}` in 9.3 seconds. No Calendar content was supplied. Reported usage was 34,041 input tokens (29,829 cache-read tokens), 35 output tokens and zero thinking tokens. This demonstrates material CLI context overhead even for a tiny request; it is not a Turkish calendar benchmark or a guarantee of subscription quota accounting.

The C.O.R. provider remains disabled: Windows standalone login/output success does not satisfy the unresolved consumer-application policy, OS isolation or Linux verification gates. Never set those verification flags merely to enable the chat UI.

The official headless documentation describes programmatic CLI output. Section 6 of the additional terms uses broad third-party-access restrictions. Technical support is not sufficient evidence of contractual permission for this integration. Obtain an applicable published clarification or Google support answer before production use. This document records a release gate, not legal advice or permission.

## Evidence record

### Dedicated Linux preparation — 2026-10-19

The operator supplied authenticated web-terminal access to a Linux Mint 22.3 x86_64 host (systemd 255). Its existing personal AGY 1.1.7 installation was left untouched. `deploy/prepare-agy-linux.sh` created `cor-agent` as a separate system identity without sudo/docker/root membership, a private `/var/lib/cor-agent` home, and a root-owned official CLI 1.4.2 at `/opt/cor-agent/bin/agy`. The vendor's Linux release archive was verified with its manifest SHA-512 before extracting only the regular `antigravity` file and checking its ELF header. No personal CLI credentials were copied.

`deploy/agy-linux-session.sh` was installed as `/opt/cor-agent/session`. It launches a transient systemd service under that identity, with a clean environment, private temporary directories/devices, protected homes, read-only system files, blocked app/database/container paths, empty capabilities, no-new-privileges and control-group cleanup. It does not install a daemon, public endpoint or sudoers grant.

First-run correction: CLI onboarding atomically rewrites its settings, which failed against the original read-only file bind mount. A version-only probe did not detect this. The explicit `sudo /opt/cor-agent/session --login` mode now permits CLI settings replacement for interactive setup only; it accepts no task/model arguments and retains the same OS containment. Default/model sessions retain the read-only settings mount. Every launcher invocation first checks that all seven required deny rules remain present and that no allow/ask grants were added. Settings validation rejects symlinks at every path component and non-regular/oversized files without printing contents. Empty default permission arrays were normalized away; existing user preferences are preserved by preparation. A real bounded interactive probe reached theme onboarding with no atomic-rename/settings error. Authentication and post-login read-only model startup still require testing; this change does not certify the production provider.

The actual restricted service passed synthetic checks for non-root identity, blocked personal home and Docker access, no-new-privileges, read-only policy and writable agent workspace. Its synthetic descendant stopped on service exit. The official CLI reported 1.4.2 inside that service. A separate root-only canary read was denied. These tests do not prove model tool denial, arbitrary escape prevention, access to actual future application secret files, secure keyring persistence or login survival after reboot. Dedicated Linux Google sign-in and subsequent model tests are still pending. No production integration gate was flipped.

### Post-login checks — 2026-10-19

After the operator completed and closed the dedicated login session, a fresh restricted service successfully listed the account's Gemini Flash Low/Medium/High models without a settings error. A separate fresh service returned `SUCCESS` and `structured_output={"ok":true}` with Flash Low, low effort, sandbox and a 45-second print timeout. Usage: 25,764 input, 34 output, zero thinking, zero cache-read tokens. This verifies session reopen and one real model request, not reboot survival or verified encryption-at-rest of the keyring.

A disposable synthetic tool-boundary probe observed `view_file` and `run_command` tool steps. Its random readable canary did not appear in captured output and the requested write artifact was absent, but the CLI ended in `ERROR`, so the full tool-denial gate remains incomplete. The generic denial-text matcher also needs stricter tool-result evidence before it can be used as a pass criterion. No actual app secret or Calendar event was used. Probe usage: 54,010 input and 658 output tokens; avoid repeating this expensive test without a specific unresolved concern.

The English bootstrap/routine-skill behavior test was prepared by `scripts/agy-fixtures.ts` using only a synthetic Turkish reminder request. Automatic approval review rejected transmitting those local skill files without a more explicit user approval. They were not transmitted. The separate synthetic tool test contained none of those skill files. Approval for the skill payload is pending; provider integration remains disabled.

| Requirement                                                  | Evidence                                        | Status  |
| ------------------------------------------------------------ | ----------------------------------------------- | ------- |
| Google clarification covering this C.O.R. use                | Not supplied                                    | Pending |
| Exact official CLI version and binary provenance             | Official Windows CLI 1.4.2; installer checksum verified, version/help passed | Windows verified |
| Personal subscription login on Linux                         | Not exercised                                   | Pending |
| Login survives logout/reboot with secure keyring             | Not exercised                                   | Pending |
| Independent OS account denies access to app/database secrets | Not exercised                                   | Pending |
| CLI tool policy denies terminal/file/browser/network tools   | Not exercised                                   | Pending |
| Sandbox prevents child escape and process-tree survival      | Not exercised                                   | Pending |
| Model passes Turkish calendar/routine fixtures               | Not exercised                                   | Pending |
| Authentication/quota/timeout/cancellation fixtures           | Adapter errors handled; live runtime unverified | Pending |

## Operator procedure

The repository includes `deploy/agy-policy.json`, a deny-all profile for the documented CLI permission namespaces. Install/merge it only in the dedicated agent identity's `~/.gemini/antigravity-cli/settings.json`; it is not automatically applied to the operator's personal CLI profile. Denying model tools is distinct from denying the CLI's own authentication/model transport and does not replace OS isolation. Perform file-read, write, terminal, web and MCP denial probes with synthetic canaries before recording the gate as verified. See Google's [CLI permission documentation](https://www.antigravity.google/docs/permissions#cli-fine-grained-permissions).

Cancellation hardening (2026-10-19): the adapter disables slash expansion, sets the CLI's own print timeout, rejects overlapping calls through the same provider instance, and rejects pre-canceled calls before launching a process. On POSIX it launches a dedicated process group and kills the group; on Windows it uses the absolute OS `taskkill.exe` with `/T /F`, a sanitized environment and no shell. This cleanup is not a sandbox and cannot prove that a deliberately escaping process is contained. A synthetic Windows parent/descendant probe (`npx tsx scripts/verify-process-tree.ts`) passed; Linux cleanup and adversarial escape remain unverified. Nine provider/process-control unit tests passed.

1. Install the official CLI and record its exact version. Do not extract browser cookies or copy OAuth tokens into C.O.R.
2. Create a dedicated unprivileged agent identity with a dedicated home/work directory and secure credential store. It must not read `.env`, application files containing secrets, PostgreSQL credentials, backups or host files.
3. Configure the pinned CLI's supported tool policy to deny all built-in execution/file/browser tools. Test the denial with adversarial prompts. `--sandbox` alone is not proof of deny-all behavior.
4. Verify external restrictions with OS-level controls; the boolean isolation flag is a record of a completed test, not the isolation mechanism itself. The current child adapter clears inherited application secrets and avoids a shell, but cannot isolate a same-user process by itself.
5. Configure a trusted launcher via `AGY_COMMAND` if identity separation requires one. Validate the launcher and process-tree cancellation on the target OS. Do not run the app as root or grant general passwordless sudo.
6. Select a model from the actual account model list. Run fixed Turkish date, ambiguity, guest, recurrence and routine cases. Choose the lowest-resource model that passes, not an assumed model slug. Record reported token usage; no fixed subscription quota is assumed.
7. Only after these prerequisites set `AGY_APPROVAL_EVIDENCE` to the evidence location, `AGY_LINUX_VERIFIED=true`, `AGY_ISOLATION_VERIFIED=true`, `AGY_WORKDIR`, `AGY_MODEL`, then `AGY_ENABLED=true` in a verified native deployment.
8. Run `npm run agy:probe`, then rerun it after server reboot. Confirm authentication, timeout, quota and cancellation behavior without exposing credentials.

The default Compose file forces AGY off and does not mount host credentials. Do not remove this gate simply to make the chat panel respond. The rest of the application is independently usable.

## Rollback

Disable `AGY_ENABLED`, restart the app and preserve the operation journal. Reconcile any unknown operation against Google before issuing a new request. No paid model API fallback is configured.
