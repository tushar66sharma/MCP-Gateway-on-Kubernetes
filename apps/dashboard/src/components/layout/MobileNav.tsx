import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { RefObject } from 'react';
import { useReturnFocus } from '../../lib/useReturnFocus';
import { SidebarContent } from './Sidebar';

export const MOBILE_NAV_ID = 'mobile-nav';

export interface MobileNavProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The hamburger button that opens the drawer (it lives in the TopBar); focus returns to it on close. */
  returnFocusTo: RefObject<HTMLElement | null>;
}

/** Below 1024 px the navigation lives in a drawer: a Radix Dialog, so it is focus-trapped and closes on Esc. */
export function MobileNav({ open, onOpenChange, returnFocusTo }: MobileNavProps) {
  const focusReturn = useReturnFocus({ hasTrigger: false, returnFocusTo });
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay animate-fade-in lg:hidden" />
        <Dialog.Content
          id={MOBILE_NAV_ID}
          aria-describedby={undefined}
          onOpenAutoFocus={focusReturn.onOpenAutoFocus}
          onCloseAutoFocus={focusReturn.onCloseAutoFocus}
          className="fixed inset-y-0 left-0 z-50 w-[min(288px,calc(100vw-3rem))] shadow-overlay animate-drawer-in focus:outline-none lg:hidden"
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <SidebarContent onNavigate={() => onOpenChange(false)} />
          <Dialog.Close
            aria-label="Close navigation"
            className="absolute top-4 right-3 grid size-8 place-items-center rounded-control text-rail-muted hover:bg-rail-hover hover:text-rail-fg focus-visible:outline-rail-signal"
          >
            <X aria-hidden className="size-4" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
