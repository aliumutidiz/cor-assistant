/** Keep dialog headings visible and avoid opening a phone keyboard before the user chooses a field. */
export function focusDialog(event: Event) {
  event.preventDefault();
  if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true });
}
