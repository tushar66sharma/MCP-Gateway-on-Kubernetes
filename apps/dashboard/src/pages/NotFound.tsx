import { Compass, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { BrandName } from '../components/layout/BrandMark';
import { buttonClasses } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-4 py-8 sm:px-10">
      <BrandName className="text-fg" />
      <main className="flex flex-1 items-center justify-center">{children}</main>
    </div>
  );
}

export function NotFound() {
  return (
    <Frame>
      <EmptyState
        icon={<Compass aria-hidden />}
        title="Page not found"
        description="The address may be mistyped, or the page has moved."
        action={
          <Link to="/" className={buttonClasses('primary')}>
            Go to overview
          </Link>
        }
      />
    </Frame>
  );
}

/** Shown when a route throws while rendering: never a blank screen. */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  return (
    <Frame>
      <EmptyState
        icon={<TriangleAlert aria-hidden />}
        title="Something went wrong on this page"
        description="Reload the page to try again. If it keeps happening, check the gateway logs."
        action={
          <button type="button" className={buttonClasses('primary')} onClick={() => window.location.reload()}>
            Reload page
          </button>
        }
      />
    </Frame>
  );
}
