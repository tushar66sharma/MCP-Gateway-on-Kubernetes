import { useRef, type RefObject } from 'react';

export interface ReturnFocusOptions {
  /** True when the dialog has a Radix `Trigger`; Radix then returns focus to it by itself. */
  hasTrigger: boolean;
  /** Where focus goes on close, ahead of anything else (while it is still in the document). */
  returnFocusTo?: RefObject<HTMLElement | null> | undefined;
}

function focusable(el: HTMLElement | null | undefined): el is HTMLElement {
  return Boolean(el?.isConnected);
}

/**
 * Focus return for Radix dialogs that are opened without a `Trigger` (controlled `open`), where Radix
 * itself drops focus to `<body>` on close. Spread the handlers onto `Dialog.Content`/`AlertDialog.Content`.
 *
 * On close, focus goes to the first of:
 *   1. `returnFocusTo`, if it is still in the document;
 *   2. the Radix trigger, if there is one (Radix's own behaviour, left alone);
 *   3. the element that had focus when the dialog opened, if it is still in the document (a menu item
 *      that opened the dialog has usually unmounted by then);
 *   4. `#main`, so keyboard users land somewhere sensible instead of at the top of the page.
 */
export function useReturnFocus({ hasTrigger, returnFocusTo }: ReturnFocusOptions) {
  const opener = useRef<HTMLElement | null>(null);

  const onOpenAutoFocus = () => {
    // Radix fires this before it moves focus inside, so activeElement is still the opener.
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  };

  const onCloseAutoFocus = (event: Event) => {
    const explicit = returnFocusTo?.current;
    if (!focusable(explicit) && hasTrigger) return;
    const target = focusable(explicit)
      ? explicit
      : focusable(opener.current)
        ? opener.current
        : document.getElementById('main');
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return { onOpenAutoFocus, onCloseAutoFocus };
}
