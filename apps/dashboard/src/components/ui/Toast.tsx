import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { Toast as RadixToast } from 'radix-ui';
import { useSyncExternalStore } from 'react';
import { errorMessage, type ApiError } from '../../lib/api';

interface ToastItem {
  id: number;
  tone: 'success' | 'error';
  title: string;
  requestId?: string;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const MAX_VISIBLE = 4;

function emit() {
  listeners.forEach((l) => l());
}

function push(item: Omit<ToastItem, 'id'>) {
  items = [...items, { ...item, id: nextId++ }].slice(-MAX_VISIBLE);
  emit();
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/**
 * Notifications from anywhere (mutations, copy buttons): `toast.success('Server added')`,
 * `toast.error(err)`. An error toast for an `ApiError` shows its request id, which matches the gateway log.
 */
export const toast = {
  success(message: string): void {
    push({ tone: 'success', title: message });
  },
  error(err: ApiError | string): void {
    if (typeof err === 'string') push({ tone: 'error', title: err });
    else push({ tone: 'error', title: errorMessage(err), ...(err.requestId !== undefined && { requestId: err.requestId }) });
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Renders the toasts. Mount it once, near the root. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items);
  return (
    <RadixToast.Provider swipeDirection="right" label="Notification">
      {list.map((t) => (
        <RadixToast.Root
          key={t.id}
          type={t.tone === 'error' ? 'foreground' : 'background'}
          duration={t.tone === 'error' ? 8000 : 4000}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
          className={clsx(
            'pointer-events-auto relative flex w-full items-start gap-3 rounded-card border border-border bg-surface p-4 pr-10 shadow-overlay',
            'animate-fade-in data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=end]:translate-x-full',
          )}
        >
          {t.tone === 'success' ? (
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          )}
          <div className="min-w-0">
            <RadixToast.Title className="text-sm font-medium text-fg">{t.title}</RadixToast.Title>
            {t.requestId ? (
              <RadixToast.Description className="mt-1 text-xs text-fg-subtle">
                Request ID <span className="font-mono select-all">{t.requestId}</span>
              </RadixToast.Description>
            ) : null}
          </div>
          <RadixToast.Close
            aria-label="Dismiss notification"
            className="absolute top-3 right-3 grid size-6 place-items-center rounded-control text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            <X aria-hidden className="size-3.5" />
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className="fixed right-0 bottom-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
    </RadixToast.Provider>
  );
}
