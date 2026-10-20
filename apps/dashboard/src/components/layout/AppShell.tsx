import { useState } from 'react';
import { Outlet } from 'react-router';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * The signed-in frame: skip link, the navigation rail (a drawer below 1024 px), the top bar and `<main>`.
 * Landmarks: `<header>` (TopBar), `<nav>` (inside the rail or drawer) and `<main>`.
 */
export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const wide = useMediaQuery('(min-width: 1024px)', false);

  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only rounded-control bg-accent px-4 py-2 text-sm font-medium text-accent-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70]"
      >
        Skip to content
      </a>
      <Sidebar />
      {/* The drawer never stays open once the window is wide enough for the rail. */}
      <MobileNav open={navOpen && !wide} onOpenChange={setNavOpen} />
      <div className="flex min-h-dvh flex-col lg:pl-[248px]">
        <TopBar onOpenNav={() => setNavOpen(true)} />
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 focus:outline-none sm:px-6 sm:py-8 lg:px-10">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
