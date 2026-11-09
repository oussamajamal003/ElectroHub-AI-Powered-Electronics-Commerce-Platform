import { useLayoutEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import type { User } from '@/features/auth/types';
import { AdminEmailChangeDialog } from './AdminEmailChangeDialog';

const storyAdmin: User = { id: 'email-change-story-admin', email: 'admin@example.test', firstName: 'Alex', lastName: 'Morgan', role: 'ADMIN' };
const pending = {
  pendingEmail: 'new-admin@example.test', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  otpExpiresAt: new Date(Date.now() + 60_000).toISOString(), resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
  attemptsRemaining: 5, deliveryStatus: 'ACCEPTED_BY_PROVIDER',
};

function clearStoryIdentity() {
  for (const key of ['electrohub:cached-user', 'electrohub:header-identity']) {
    try { sessionStorage.removeItem(key); localStorage.removeItem(key); } catch { /* Storage may be unavailable in the preview. */ }
  }
}

/** The real AdminEmailChangeDialog and AuthProvider use a local-only network boundary in Storybook. */
function AdminEmailChangeStage() {
  const [queryClient] = useState(() => { clearStoryIdentity(); return new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
  useLayoutEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const reply = url.pathname === '/api/auth/admin/refresh' ? { status: 200, body: { accessToken: 'storybook-disposable-access-token' } }
        : url.pathname === '/api/auth/me' ? { status: 200, body: { user: storyAdmin } }
        : url.pathname === '/api/admin/me/email-change/status' ? { status: 200, body: { data: { active: false } } }
        : url.pathname === '/api/admin/me/email-change/request' && method === 'POST' ? { status: 202, body: { data: pending } }
        : url.pathname === '/api/admin/me/email-change/verify' && method === 'POST' ? { status: 200, body: { data: { changed: true, email: pending.pendingEmail, signedOut: true } } }
        : url.pathname === '/api/admin/me/email-change/cancel' && method === 'POST' ? { status: 200, body: { data: { cancelled: true } } }
        : { status: 404, body: { error: { code: 'STORY_ENDPOINT_NOT_FOUND', message: 'No Storybook response is configured.' } } };
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
    };
    return () => { window.fetch = originalFetch; queryClient.clear(); };
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}><AuthProvider><MemoryRouter initialEntries={['/admin/profile']}>
    <main style={{ maxWidth: 640, margin: '48px auto', padding: 24 }}>
      <h1>Personal details</h1><p>Administrator: {storyAdmin.firstName} {storyAdmin.lastName}</p>
      <AdminEmailChangeDialog currentEmail={storyAdmin.email} />
    </main>
  </MemoryRouter></AuthProvider></QueryClientProvider>;
}

const meta = { title: 'Admin/Security/Email Change', component: AdminEmailChangeStage, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof AdminEmailChangeStage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Flow: Story = {};
