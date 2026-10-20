import { useCallback, useSyncExternalStore } from 'react';

/**
 * Tracks a media query. Where `matchMedia` is missing (jsdom in unit tests) it reports `fallback`,
 * which defaults to "matches" so components render their desktop layout there.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const snapshot = () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback);
  return useSyncExternalStore(subscribe, snapshot, () => fallback);
}

/** Tailwind's `sm` breakpoint: tables at 640 px and wider, stacked cards below. */
export const TABLE_BREAKPOINT = '(min-width: 640px)';
