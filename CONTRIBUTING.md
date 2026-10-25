# Contributing to C.O.R.

Thank you for helping build a focused personal planning assistant. Start with a small issue or proposal explaining the user problem and scope. The project does not aim to become an unrestricted agent or hosted multi-tenant platform.

## Local development

Use Node.js 24 LTS and a fresh clone. Run `npm ci`, `npm run setup -- --demo`, then `npm run dev`. Never use production credentials or a live calendar in a test. `npm run check`, `npm test` and `npm run build` are the required core checks. Browser checks use `npm run test:e2e` after `npx playwright install chromium`; services use separate local ports and demo storage.

For persistence tests, use a disposable PostgreSQL database. The optional `TEST_DATABASE_URL` suite can change that database. Native Linux integrations have additional tests in `deploy/`.

## Pull requests

Explain the concrete problem, resulting behavior and relevant validation. Include screenshots for interface changes using synthetic records only. Update documentation for changed configuration or operating limits. Keep migrations backward compatible and preserve record revisions, idempotency and unknown outcomes. Add meaningful tests for changed behavior rather than repeating implementation details.

Skills and technical documentation are written in English. UI text defaults to English; agent reply language comes from the owner's profile or explicit request. Avoid embedding personal data, language assumptions, host paths, tokens, chat IDs or deployment-specific settings.

Do not weaken authentication, approvals, external-content isolation, SSRF protections, secret boundaries or provider gates to make an integration work. Do not introduce automatic paid fallbacks. New integrations should be optional and have explicit setup and data-flow documentation.

## Reporting problems

Use GitHub issues for reproducible non-sensitive bugs and feature proposals. Include your OS, app version, safe error category and expected behavior. Remove personal records, OAuth URLs, cookies, tokens, email addresses and message history from attachments. Use the private security reporting channel for vulnerabilities; see SECURITY.md.

By contributing, you agree that your contributions are licensed under the project's PolyForm Noncommercial 1.0.0 license. Third-party code and assets need compatible licensing and attribution. Be respectful and constructive; see CODE_OF_CONDUCT.md.
