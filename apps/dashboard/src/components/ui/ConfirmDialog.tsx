import { clsx } from 'clsx';
import { AlertDialog } from 'radix-ui';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from './Button';

export interface ConfirmDialogProps {
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  /** May return a promise: the dialog shows a spinner, closes when it resolves and stays open if it rejects. */
  onConfirm: () => void | Promise<void>;
  /** The element that opens the dialog. Omit it to control the dialog with `open` / `onOpenChange`. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Asks before a destructive action (spec §7). Built on Radix AlertDialog: focus moves inside (to Cancel,
 * the safe choice), Esc and Cancel close it, and focus returns to whatever opened it.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  trigger,
  open: openProp,
  onOpenChange,
}: ConfirmDialogProps) {
  const [openState, setOpenState] = useState(false);
  const [busy, setBusy] = useState(false);
  // Without a Radix trigger (a controlled dialog opened from a menu), remember what had focus ourselves.
  const returnFocus = useRef<HTMLElement | null>(null);
  const open = openProp ?? openState;

  const setOpen = (next: boolean) => {
    if (busy && !next) return; // Not while the action runs: its outcome decides.
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      setBusy(false);
      if (openProp === undefined) setOpenState(false);
      onOpenChange?.(false);
    } catch {
      // The caller reports the error (usually a toast); keep the dialog open so the user can retry or cancel.
      setBusy(false);
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      {trigger ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-overlay animate-fade-in" />
        <AlertDialog.Content
          onOpenAutoFocus={() => {
            // Still the element that had focus before the dialog opened (Radix moves focus after this event).
            if (!trigger) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            if (trigger) return;
            const target = returnFocus.current;
            if (target?.isConnected) {
              e.preventDefault();
              target.focus();
            }
          }}
          className={clsx(
            'fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
            'rounded-dialog border border-border bg-surface p-6 shadow-overlay animate-dialog-in focus:outline-none',
          )}
        >
          <AlertDialog.Title className="text-base font-semibold tracking-[-0.01em] text-fg">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-sm leading-relaxed text-fg-muted">{body}</div>
          </AlertDialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button disabled={busy}>{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={() => void confirm()}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
