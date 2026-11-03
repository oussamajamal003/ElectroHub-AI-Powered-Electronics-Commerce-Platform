import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog } from './AdminUi';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

// The product form is keyed by updatedAt, so every successful save remounts it clean. `version` plays that key here.
function Form({ dirty }: { dirty: boolean }) {
  const guard = useUnsavedChangesGuard(dirty);
  return <><p>Form page</p><ConfirmDialog {...guard.dialog} title="Leave without saving?" confirmLabel="Leave page" description="Lost." /></>;
}
function App({ version, dirty }: { version: number; dirty: boolean }) {
  return <BrowserRouter><Routes>
    <Route path="/admin/products" element={<p>List page</p>} />
    <Route path="/admin/products/p1/edit" element={<Form key={version} dirty={dirty} />} />
  </Routes></BrowserRouter>;
}

// Real history traversal is asynchronous; 50 ms keeps it reliable when the suite runs under load.
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
async function start() {
  window.history.replaceState(null, '', '/admin/products');
  window.history.pushState(null, '', '/admin/products/p1/edit');
  const view = render(<App version={0} dirty={false} />);
  return async (version: number, dirty: boolean) => { view.rerender(<App version={version} dirty={dirty} />); await settle(); };
}
async function back() { await act(async () => { window.history.back(); }); await settle(); }

describe('useUnsavedChangesGuard history lifecycle', () => {
  it('one save (edit, then remount clean) leaves no extra entry: one Back reaches the previous route', async () => {
    const step = await start();
    await step(0, true);
    await step(1, false);
    await back();
    await waitFor(() => expect(screen.getByText('List page')).toBeInTheDocument());
  });

  it('two save cycles still need only one Back', async () => {
    const step = await start();
    await step(0, true); await step(1, false);
    await step(1, true); await step(2, false);
    await back();
    await waitFor(() => expect(screen.getByText('List page')).toBeInTheDocument());
  });

  it('edits after a save are guarded again: Back asks, Cancel keeps the page, Leave exits once', async () => {
    const step = await start();
    await step(0, true); await step(1, false);
    await step(1, true);
    await back();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(screen.getByText('Form page')).toBeInTheDocument();
    await back();
    fireEvent.click(screen.getByRole('button', { name: 'Leave page' }));
    await settle();
    await waitFor(() => expect(screen.getByText('List page')).toBeInTheDocument());
  });

  it('a clean form never asks and adds no entry', async () => {
    await start();
    await back();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByText('List page')).toBeInTheDocument());
  });
});
