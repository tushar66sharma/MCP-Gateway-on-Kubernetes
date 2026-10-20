import { clsx } from 'clsx';
import { ChevronDown, LogOut, Menu, Monitor, Moon, Sun } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useEffect, type Ref } from 'react';
import { useMatches, useNavigate } from 'react-router';
import { ApiError } from '../../lib/api';
import { useLogout, useMe } from '../../lib/auth';
import { useThemePreference, type ThemePreference } from '../../lib/theme';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';
import { MOBILE_NAV_ID } from './MobileNav';

export interface RouteHandle {
  title?: string;
}

/** The title of the deepest route that declares one in its `handle`. */
function usePageTitle(): string | undefined {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const title = (matches[i]?.handle as RouteHandle | undefined)?.title;
    if (title) return title;
  }
  return undefined;
}

const menuContent =
  'z-50 min-w-[14rem] rounded-card border border-border bg-surface p-1.5 text-sm text-fg shadow-overlay animate-fade-in';
const menuItem =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-control px-2.5 outline-none select-none data-[highlighted]:bg-surface-hover [&_svg]:size-4 [&_svg]:text-fg-subtle';

const THEMES: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

function ThemeMenu() {
  const [pref, setPref] = useThemePreference();
  const current = THEMES.find((t) => t.value === pref) ?? THEMES[0]!;
  const Icon = current.icon;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" aria-label={`Theme: ${current.label}`} icon={<Icon aria-hidden />} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className={clsx(menuContent, 'min-w-[10rem]')}>
          <DropdownMenu.Label className="px-2.5 py-1.5 text-xs font-medium text-fg-subtle">Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={pref} onValueChange={(v) => setPref(v as ThemePreference)}>
            {THEMES.map(({ value, label, icon: ItemIcon }) => (
              <DropdownMenu.RadioItem key={value} value={value} className={clsx(menuItem, 'data-[state=checked]:font-medium data-[state=checked]:text-accent-text')}>
                <ItemIcon aria-hidden />
                {label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0]?.slice(0, 2) ?? '?');
  return letters.toUpperCase();
}

function UserMenu() {
  const { me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  if (!me) return null;

  const signOut = async () => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err : 'Couldn’t log out. Try again.');
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Account: ${me.name}`}
          className="flex h-10 items-center gap-2.5 rounded-control pr-2 pl-1 text-sm hover:bg-surface-hover"
        >
          <span aria-hidden className="grid size-8 place-items-center rounded-full bg-accent-subtle text-xs font-semibold text-accent-text">
            {initials(me.name)}
          </span>
          <span className="hidden max-w-[12rem] truncate font-medium text-fg sm:block">{me.name}</span>
          <ChevronDown aria-hidden className="hidden size-4 text-fg-subtle sm:block" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className={menuContent}>
          <div className="px-2.5 pt-2 pb-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate font-medium text-fg">{me.name}</p>
              <Badge tone={me.role === 'admin' ? 'accent' : 'neutral'}>{me.role === 'admin' ? 'Admin' : 'Member'}</Badge>
            </div>
            <p className="mt-0.5 truncate text-[0.8125rem] text-fg-muted">{me.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={menuItem} onSelect={() => void signOut()}>
            <LogOut aria-hidden />
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export interface TopBarProps {
  onOpenNav: () => void;
  /** Whether the navigation drawer is open (for the hamburger's `aria-expanded`). */
  navOpen: boolean;
  navButtonRef?: Ref<HTMLButtonElement>;
}

export function TopBar({ onOpenNav, navOpen, navButtonRef }: TopBarProps) {
  const title = usePageTitle();

  useEffect(() => {
    document.title = title ? `${title} – Urumi Gateway` : 'Urumi Gateway';
  }, [title]);

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-6 lg:px-10">
      <Button
        ref={navButtonRef}
        variant="ghost"
        className="-ml-2 lg:hidden"
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-expanded={navOpen}
        aria-controls={MOBILE_NAV_ID}
        icon={<Menu aria-hidden />}
        onClick={onOpenNav}
      />
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg-muted">{title}</p>
      <div className="flex items-center gap-1">
        <ThemeMenu />
        <UserMenu />
      </div>
    </header>
  );
}
