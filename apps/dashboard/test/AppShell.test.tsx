import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/components/layout/AppShell';
import { admin, jsonResponse, mockFetch, Providers } from './helpers';

/** A controllable `matchMedia`: `(min-width: Npx)` queries match when the fake window is at least N wide. */
function mockViewport(initialWidth: number) {
  let width = initialWidth;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    };
  });
  return {
    resize(next: number) {
      width = next;
      act(() => listeners.forEach((l) => l()));
    },
  };
}

async function renderShell() {
  mockFetch({ 'GET /api/auth/me': () => jsonResponse(200, { user: admin }) });
  const router = createMemoryRouter([{ path: '/', element: <AppShell />, children: [{ index: true, element: <p>overview content</p> }] }]);
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  await screen.findByText('overview content');
  return screen.getByRole('button', { name: 'Open navigation' });
}

describe('AppShell navigation drawer', () => {
  it('the hamburger reports the drawer state with aria-expanded', async () => {
    mockViewport(390);
    const hamburger = await renderShell();
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    expect(hamburger).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(hamburger);
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(hamburger).toHaveAttribute('aria-expanded', 'true');
    expect(hamburger).toHaveAttribute('aria-controls', drawer.id);
  });

  it('Esc closes the drawer and focus returns to "Open navigation"', async () => {
    mockViewport(390);
    const hamburger = await renderShell();
    await userEvent.click(hamburger);
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(hamburger).toHaveFocus();
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
  });

  it('"Close navigation" also returns focus to the hamburger', async () => {
    mockViewport(390);
    const hamburger = await renderShell();
    await userEvent.click(hamburger);
    await userEvent.click(await screen.findByRole('button', { name: 'Close navigation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(hamburger).toHaveFocus();
  });

  it('widening the window closes the drawer, and narrowing again does not reopen it', async () => {
    const viewport = mockViewport(390);
    const hamburger = await renderShell();
    await userEvent.click(hamburger);
    await screen.findByRole('dialog', { name: 'Navigation' });
    viewport.resize(1440);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    viewport.resize(390);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
  });
});
