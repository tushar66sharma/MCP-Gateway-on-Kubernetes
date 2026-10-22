import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { KeyCreatedDialog } from '../src/features/keys/KeyCreatedDialog';

const KEY = `ugw_${'x'.repeat(43)}`;

function Host() {
  const [plaintext, setPlaintext] = useState<string | null>(KEY);
  return (
    <>
      <p>{plaintext === null ? 'closed' : 'open'}</p>
      <KeyCreatedDialog plaintext={plaintext} onClose={() => setPlaintext(null)} />
    </>
  );
}

describe('KeyCreatedDialog', () => {
  it('shows the key once with a warning and the three snippets', () => {
    render(<Host />);
    expect(screen.getByText(/You will not see this key again/)).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toHaveValue(KEY);
    expect(screen.getByRole('tab', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cursor' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'MCP Inspector' })).toBeInTheDocument();
  });

  it('close requires confirmation', async () => {
    render(<Host />);
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('open')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'I have copied the key' }));
    expect(close).toBeEnabled();
    await userEvent.click(close);
    expect(screen.getByText('closed')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(KEY)).toBeNull();
  });

  it('plaintext is not in localStorage or sessionStorage after close', async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'I have copied the key' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        const k = store.key(i) ?? '';
        expect(k).not.toContain(KEY);
        expect(store.getItem(k) ?? '').not.toContain(KEY);
      }
    }
    expect(document.body.textContent).not.toContain(KEY);
  });
});
