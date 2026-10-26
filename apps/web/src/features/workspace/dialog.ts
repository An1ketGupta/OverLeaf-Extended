import type { KeyboardEvent } from "react";

// Native modal dialogs can send Tab from the last control to browser chrome.
// Keep keyboard focus in the active task and let each dialog own Escape/busy rules.
export function containDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    ),
  ].filter(
    (node) =>
      node.getClientRects().length > 0 && !node.closest("[hidden], [inert]"),
  );
  const first = controls[0],
    last = controls.at(-1);
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  if (
    (!event.shiftKey && document.activeElement === last) ||
    (event.shiftKey && document.activeElement === first)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
