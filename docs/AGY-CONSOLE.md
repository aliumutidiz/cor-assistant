# Isolated console integration

The operator explicitly selected this unsupported consumer integration after the
Google FAQ restriction was disclosed. See `AGY-VERIFICATION.md` for the decision,
technical evidence and limits. Do not describe it as vendor-approved.

Install the reviewed `deploy/agy-broker.py` as root-owned `/opt/cor-agent/broker.py`
and `deploy/cor-agy.service` as the matching systemd unit. The dedicated `cor-agent`
identity/home/login and deny-all settings must already exist. Create a dedicated
`cor-llm` group; the broker uses it for `/run/cor-agy/model.sock`, while the application
receives it only as a supplementary group. The broker authenticates the connecting
UID with Unix peer credentials and accepts only `cor`. No public model port or
general sudo permission is added.

Set native app `AGY_SOCKET=/run/cor-agy/model.sock` after the technical checks pass.
The existing model/isolation/evidence gates remain mandatory and must describe real
tests and the operator decision truthfully. The broker fixes the model to Flash Low,
effort low, schema output, denied tools and request deadlines. It rejects
`useG1Credits=true`; the dedicated CLI settings explicitly set that field false.
Requests carry only prompt/schema. Tokens and application secrets are not copied
between identities. Prompts travel through stdin, not command-line arguments.

The application bounds recent conversation to four messages of at most 600
characters each and loads only the selected skill. Each request uses fresh CLI
context rather than indefinitely growing remote conversation state. A request can
involve routing and several read/response steps; token overhead is visible in usage.
No automatic retry or paid provider fallback is configured for quota errors.

Root-owned broker/unit files are deliberately not self-updated by GitHub source.
Install reviewed changes manually, then restart the broker when idle. Application
TypeScript updates follow the normal test/build/deploy timer. To roll back, set
`AGY_ENABLED=false` in the private environment and restart only `cor.service`.
