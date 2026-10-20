import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Button } from '../src/components/ui/Button';
import { Dialog } from '../src/components/ui/Dialog';

describe('Dialog', () => {
  it('a controlled dialog without a trigger returns focus to the element that opened it', async () => {
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Create key</Button>
          <Dialog open={open} onOpenChange={setOpen} title="Your new API key">
            shown once
          </Dialog>
        </>
      );
    }
    render(<Controlled />);
    const opener = screen.getByRole('button', { name: 'Create key' });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Your new API key' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('focus goes to returnFocusTo when the opener has left the DOM', async () => {
    function MenuOpened() {
      const [open, setOpen] = useState(false);
      const [menuOpen, setMenuOpen] = useState(true);
      const menuButton = useRef<HTMLButtonElement>(null);
      return (
        <>
          <Button ref={menuButton}>Actions</Button>
          {menuOpen && (
            <Button
              onClick={() => {
                setOpen(true);
                setMenuOpen(false); // like a menu item that unmounts when the menu closes
              }}
            >
              Invite someone
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen} title="Invite someone" returnFocusTo={menuButton}>
            form
          </Dialog>
        </>
      );
    }
    render(<MenuOpened />);
    await userEvent.click(screen.getByRole('button', { name: 'Invite someone' }));
    await screen.findByRole('dialog', { name: 'Invite someone' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus();
  });

  it('with no opener left and no returnFocusTo, focus falls back to main', async () => {
    function Orphan() {
      const [open, setOpen] = useState(false);
      const [shown, setShown] = useState(true);
      return (
        <main id="main" tabIndex={-1}>
          {shown && (
            <Button
              onClick={() => {
                setOpen(true);
                setShown(false);
              }}
            >
              Open
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen} title="Details">
            body
          </Dialog>
        </main>
      );
    }
    render(<Orphan />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog', { name: 'Details' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('a non-dismissible dialog ignores Esc', async () => {
    render(
      <Dialog open title="Copy your key now" dismissible={false}>
        secret
      </Dialog>,
    );
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Copy your key now' })).toBeInTheDocument();
  });
});
