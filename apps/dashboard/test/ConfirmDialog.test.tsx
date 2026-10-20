import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../src/components/ui/Button';
import { ConfirmDialog } from '../src/components/ui/ConfirmDialog';

function renderDialog(onConfirm: () => void | Promise<void> = vi.fn()) {
  render(
    <ConfirmDialog
      trigger={<Button>Delete server</Button>}
      title="Delete Notes?"
      body="Clients lose access to its tools immediately."
      confirmLabel="Delete server"
      tone="danger"
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe('ConfirmDialog', () => {
  it('moves focus into the dialog when it opens', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Delete server' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Notes?' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(dialog).toHaveTextContent('Clients lose access to its tools immediately.');
  });

  it('Esc closes it and focus returns to the trigger', async () => {
    renderDialog();
    const trigger = screen.getByRole('button', { name: 'Delete server' });
    await userEvent.click(trigger);
    await screen.findByRole('alertdialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('Cancel closes it without confirming', async () => {
    const onConfirm = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Delete server' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Confirm calls onConfirm and closes when it resolves', async () => {
    const onConfirm = renderDialog(vi.fn().mockResolvedValue(undefined));
    await userEvent.click(screen.getByRole('button', { name: 'Delete server' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete server' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('returns focus to the opener when controlled without a trigger', async () => {
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Revoke key</Button>
          <ConfirmDialog open={open} onOpenChange={setOpen} title="Revoke key?" body="Clients using it stop working." confirmLabel="Revoke" onConfirm={vi.fn()} />
        </>
      );
    }
    render(<Controlled />);
    const opener = screen.getByRole('button', { name: 'Revoke key' });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('alertdialog', { name: 'Revoke key?' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('stays open when onConfirm rejects', async () => {
    const onConfirm = renderDialog(vi.fn().mockRejectedValue(new Error('nope')));
    await userEvent.click(screen.getByRole('button', { name: 'Delete server' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete server' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Delete server' })).toBeEnabled());
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
