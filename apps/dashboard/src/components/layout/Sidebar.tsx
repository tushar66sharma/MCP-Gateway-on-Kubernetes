import { clsx } from 'clsx';
import { KeyRound, LayoutDashboard, MessageSquare, ScrollText, Server, Users, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { useMe } from '../../lib/auth';
import { BrandName } from './BrandMark';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** `/` must match exactly, or Overview would look active on every page. */
  end?: boolean;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/servers', label: 'Servers', icon: Server },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/keys', label: 'API keys', icon: KeyRound },
  { to: '/audit', label: 'Audit log', icon: ScrollText },
  { to: '/team', label: 'Team', icon: Users, adminOnly: true },
];

/** The navigation links, shared by the desktop rail and the mobile drawer. */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { me } = useMe();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || me?.role === 'admin');
  return (
    <nav aria-label="Main" className="px-3">
      <ul className="flex flex-col gap-0.5">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                clsx(
                  'group relative flex h-10 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors',
                  'focus-visible:outline-rail-signal',
                  isActive ? 'bg-rail-active text-rail-fg' : 'text-rail-muted hover:bg-rail-hover hover:text-rail-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* The signal line: the active route, drawn like a live connection into the page. */}
                  <span
                    aria-hidden
                    className={clsx(
                      'absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-rail-signal transition-opacity',
                      isActive ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <Icon aria-hidden className={clsx('size-[18px] shrink-0', isActive ? 'text-rail-signal' : 'text-rail-muted group-hover:text-rail-fg')} />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Where MCP clients connect: shown under the navigation because every new user needs it once. */
function EndpointHint() {
  const endpoint = `${window.location.origin}/mcp`;
  return (
    <div className="mx-3 rounded-card border border-rail-border px-3 py-3">
      <p className="text-xs font-medium text-rail-muted">MCP endpoint</p>
      <p className="mt-1 truncate font-mono text-xs text-rail-fg" title={endpoint}>
        {endpoint}
      </p>
    </div>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-rail text-rail-fg">
      <div className="flex h-16 shrink-0 items-center px-6">
        <BrandName />
      </div>
      <div className="flex-1 overflow-y-auto pt-4">
        <NavList onNavigate={onNavigate} />
      </div>
      <div className="shrink-0 pb-5">
        <EndpointHint />
      </div>
    </div>
  );
}

/** The fixed navigation rail on screens 1024 px and wider. */
export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-rail-border lg:block">
      <SidebarContent />
    </aside>
  );
}
