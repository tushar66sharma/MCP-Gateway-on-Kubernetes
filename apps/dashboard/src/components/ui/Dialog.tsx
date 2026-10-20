import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

export interface DialogProps {
  title: ReactNode;
  description?: ReactNode;
  /** The element that opens the dialog; focus returns to it when the dialog closes. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Buttons along the bottom edge (Cancel / Save). */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Blocks Esc and outside clicks, for the "shown once" secrets that must not vanish by accident. */
  dismissible?: boolean;
  children?: ReactNode;
}

const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

/** A modal dialog: focus-trapped, Esc to close, labelled by its title (Radix Dialog). */
export function Dialog({ title, description, trigger, open, onOpenChange, footer, size = 'md', dismissible = true, children }: DialogProps) {
  const block = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };
  return (
    <RadixDialog.Root {...(open !== undefined && { open })} {...(onOpenChange && { onOpenChange })}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay animate-fade-in" />
        <RadixDialog.Content
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={clsx(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-dialog border border-border bg-surface shadow-overlay animate-dialog-in focus:outline-none',
            widths[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-1">
            <div className="min-w-0">
              <RadixDialog.Title className="text-base font-semibold tracking-[-0.01em] text-fg">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-sm text-fg-muted">{description}</RadixDialog.Description>
              ) : null}
            </div>
            {dismissible ? (
              <RadixDialog.Close
                aria-label="Close"
                className="-mt-1 -mr-2 grid size-8 shrink-0 place-items-center rounded-control text-fg-subtle hover:bg-surface-hover hover:text-fg"
              >
                <X className="size-4" aria-hidden />
              </RadixDialog.Close>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Closes the surrounding Dialog; wrap a Cancel button in it. */
export const DialogClose = RadixDialog.Close;
