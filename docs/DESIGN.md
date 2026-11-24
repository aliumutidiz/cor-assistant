# Workspace design guide

C.O.R. is a personal planning workspace. The interface prioritizes readable schedules, explicit actions and access to the original record. Decorative copy, permanent assistant sidebars and unconstrained event lists should not compete with the user's work.

## Layout and navigation

- Desktop pages use a left workspace navigation and a flexible main area capped at 1560 px. The assistant opens on demand or as its own page.
- At 760 px and below, primary destinations move to a persistent bottom navigation. Additional destinations are available through the workspace menu. Account permissions continue to be enforced by the server.
- Settings use a section navigation on desktop and a labelled native section selector on phones.
- Optional record metadata belongs in an explicit disclosure. The primary editing task should remain visible first.

## Calendar

Month cells contain two event previews and an explicit overflow count. Selecting a date displays every matching item in a separate day list; no event is removed from the underlying data. At calendar widths of 1080 px or more, this list appears beside the month. Below that width it follows the overview. On phones, date cells show counts instead of truncated titles, and complete titles remain in the selected-day list.

Month ranges start on Monday, include the entire selected month and use the number of complete weeks actually required. Months can therefore span four, five or six weeks. The first displayed week must be calculated from the selected month's first date, not the week containing the selected date.

Day and week views retain all 24 hours. All-day rows show two initial records per day, with an explicit disclosure for remaining records. Long titles do not stretch the row vertically. Timed events keep their actual duration and overlap lanes. Small screens may scroll the week horizontally; the day view fits the available width.

## Layers and interactions

Use the existing theme palette and Geist typography. Maintain visible focus indicators, labelled controls and native form behavior. Small-screen form text uses a readable 16 px scale. Primary touch controls target at least 44 px; compact calendar dates and dense previews are supplemented by full-size list controls.

Workspace navigation, assistant overlays and modal dialogs use a deliberate stacking order. Dialog backdrops sit above navigation and chat; dialog contents sit above their backdrop. Opening a dialog focuses its container so its heading is visible and the phone keyboard is not opened before a field is selected. Escape and the labelled close control preserve expected dialog behavior.

Conversation tools are an explicit panel in the assistant header. They close on outside pointer interaction or Escape. Risk-sensitive operations still use the existing server-approved operation flow; presentation changes must not bypass approval, version or idempotency checks.

## Verification

Relevant browser checks live in:

- `e2e/calendar-density.spec.ts`: crowded months, complete overflow access, all-day sizing, first-of-month boundaries and dark tablet layout.
- `e2e/calendar-layout.spec.ts`: full-day timeline, midnight editing, short-screen navigation and month movement.
- `e2e/mobile-workspace.spec.ts`: phone navigation, width containment and composer access.
- `e2e/workspace-design.spec.ts`: workspace destinations, record layout and editor visibility on desktop and phone.
- Existing personal record, chat control and shared access tests protect the behavior beneath these layouts.

Browser fixtures use disposable demo data. Screenshots are local review artifacts under the ignored `.runtime/screenshots` directory and must not contain production records. Test desktop, phone and dark-theme layouts before claiming a visual change is complete; a passing type check alone does not establish usability.

No network, VPN, tunnel or unrelated service changes are required to publish a design update. Deploy through the existing owner-managed update controller and verify its active release and application health.
