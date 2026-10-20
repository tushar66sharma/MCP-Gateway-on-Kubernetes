import { useCallback, useSyncExternalStore } from 'react';

/**
 * Theme preference: follow the system, or force light or dark. Colours come from CSS variables written
 * with `light-dark()`; the preference only sets `color-scheme` through `<html data-theme>`, so the first
 * paint already follows the system without any inline script (the CSP forbids one).
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'urumi.theme';
const listeners = new Set<() => void>();

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    // Storage blocked (private mode, sandboxed frame): fall back to the system theme.
    return 'system';
  }
}

export function applyThemePreference(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Not persisted; the choice still applies to this page view.
  }
  current = pref;
  applyThemePreference(pref);
  listeners.forEach((l) => l());
}

let current: ThemePreference = typeof window === 'undefined' ? 'system' : readThemePreference();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemePreference(): [ThemePreference, (pref: ThemePreference) => void] {
  const pref = useSyncExternalStore(subscribe, () => current);
  const set = useCallback((next: ThemePreference) => setThemePreference(next), []);
  return [pref, set];
}
