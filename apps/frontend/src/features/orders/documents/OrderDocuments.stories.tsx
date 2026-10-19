import { useEffect, useLayoutEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import type { User } from '@/features/auth/types';
import { OrderDetailsPage } from '@/features/orders/OrderDetailsPage';
import { orderDetails, orderSummary, ordersPage } from '@/features/orders/fixtures';
import type { OrderDetails } from '@/features/orders/types';
import { OrdersPage } from '@/pages/customer/OrdersPage';
import { OrderDocumentsChooser } from './OrderDocumentsChooser';
import { OrderDocumentsPanel } from './OrderDocumentsPanel';
import type { DocumentKind, DocumentUnavailableReason, OrderDocumentEntry } from './types';

/*
 * Stories render the real providers, the real OrderDocumentsPanel / OrderDocumentsChooser and the real Orders pages. The only
 * substitution is the network boundary: a scoped window.fetch stub (installed for the life of one story and restored on unmount)
 * answers the session, order and document endpoints. Every value is synthetic and deterministic; nothing reaches a real API.
 */

type Surface = 'confirmation' | 'details' | 'chooser' | 'chooser-dialog' | 'details-page' | 'orders-page';
type Session = 'signed-in' | 'signed-out' | 'unavailable';
type Reply = { status: number; body?: unknown };
type Outcome = DocumentUnavailableReason | null;
type Plan = Record<DocumentKind, Outcome>;
type Metadata = { plan: Plan; paidAt?: string | null; description?: string } | { status: number; body: unknown } | 'pending';
type Binary = 'pdf' | { delayMs: number } | { status: number; body: unknown };
interface Scenario {
  reference?: string;
  session?: Session;
  metadata?: Metadata;
  binary?: Binary;
  order?: Partial<OrderDetails>;
}

const KINDS: DocumentKind[] = ['invoice', 'receipt', 'summary'];
/** Copied from the backend DOCUMENT_ENTRY_COPY (order-document.service.ts) so the stubbed metadata matches production copy. */
const COPY: Record<DocumentKind, { label: string; description: string }> = {
  invoice: { label: 'Order invoice (non-tax)', description: 'Itemized commercial statement of your purchase. Not a tax invoice.' },
  receipt: { label: 'Payment receipt', description: 'Confirms the card payment recorded for this order.' },
  summary: { label: 'Order summary', description: 'Order record with items, delivery and current status. Not proof of payment.' },
};
const STORY_REFERENCE = orderSummary(1).orderReference;
const LONG_REFERENCE = `${STORY_REFERENCE}-LAYOUT-CHECK-LONG-REFERENCE-VALUE`;
const LONG_DESCRIPTION = 'Itemized commercial statement of your purchase, with every line, quantity, unit price and delivery detail that was recorded for this order at purchase time. Not a tax invoice. Synthetic text used only to check how long copy wraps.';
const PAID_AT = '2026-09-04T12:01:00.000Z';
const PURCHASE_DATE = '2026-09-04T12:00:00.000Z';

const storyUser: User = { id: 'story-customer', email: 'story.customer@example.test', firstName: 'Alex', lastName: 'Morgan', role: 'CUSTOMER' };
const ok = (body: unknown): Reply => ({ status: 200, body });
const fail = (status: number, message: string): Reply => ({ status, body: { error: { code: 'STORY_ERROR', message } } });

const ALL: Plan = { invoice: null, receipt: null, summary: null };
const PENDING: Plan = { invoice: 'PAYMENT_NOT_CONFIRMED', receipt: 'PAYMENT_NOT_CONFIRMED', summary: null };
const UNVERIFIED: Plan = { invoice: 'HISTORICAL_PAYMENT_UNVERIFIED', receipt: 'HISTORICAL_PAYMENT_UNVERIFIED', summary: null };
const INCONSISTENT: Plan = { invoice: 'DATA_INCONSISTENT', receipt: 'DATA_INCONSISTENT', summary: 'DATA_INCONSISTENT' };
const ALL_AVAILABLE: Metadata = { plan: ALL };

/** Mirrors the backend entry contract: availability, reason, filenames and previewPath/downloadPath only when available. */
function entryFor(kind: DocumentKind, reference: string, outcome: Outcome, paidAt: string | null, description?: string): OrderDocumentEntry {
  const available = outcome === null;
  const base = `/api/orders/${encodeURIComponent(reference)}/documents/${kind}`;
  return {
    kind,
    label: COPY[kind].label,
    description: description ?? COPY[kind].description,
    availability: available ? 'AVAILABLE' : 'UNAVAILABLE',
    reasonCode: outcome,
    mediaType: 'application/pdf',
    filename: available ? `ElectroHub-${reference}-${kind}.pdf` : null,
    contentVersion: available ? 'story-content-1' : null,
    templateVersion: 'commercial-template-1.0.0',
    policy: 'COMMERCIAL_V1',
    issuedAt: null,
    purchaseDate: PURCHASE_DATE,
    paidAt,
    previewPath: available ? `${base}?disposition=inline` : null,
    downloadPath: available ? `${base}?disposition=attachment` : null,
  };
}

function metadataReply(scenario: Scenario, reference: string): Reply | 'pending' {
  const metadata = scenario.metadata ?? ALL_AVAILABLE;
  if (metadata === 'pending') return 'pending';
  if ('plan' in metadata) {
    const paidAt = metadata.paidAt === undefined ? PAID_AT : metadata.paidAt;
    return ok({ data: { orderReference: reference, documents: KINDS.map(kind => entryFor(kind, reference, metadata.plan[kind], paidAt, metadata.description)) } });
  }
  return { status: metadata.status, body: metadata.body };
}

/** A tiny but valid one-page PDF (Helvetica text, correct xref offsets, 602 bytes). Hard-coded so the bytes never change. */
const SAMPLE_PDF = [
  '%PDF-1.4',
  '1 0 obj',
  '<< /Type /Catalog /Pages 2 0 R >>',
  'endobj',
  '2 0 obj',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  'endobj',
  '3 0 obj',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  'endobj',
  '4 0 obj',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  'endobj',
  '5 0 obj',
  '<< /Length 58 >>',
  'stream',
  'BT /F1 24 Tf 72 720 Td (Synthetic ElectroHub sample) Tj ET',
  'endstream',
  'endobj',
  'xref',
  '0 6',
  '0000000000 65535 f ',
  '0000000009 00000 n ',
  '0000000058 00000 n ',
  '0000000115 00000 n ',
  '0000000241 00000 n ',
  '0000000311 00000 n ',
  'trailer',
  '<< /Size 6 /Root 1 0 R >>',
  'startxref',
  '419',
  '%%EOF',
  '',
].join('\n');
const SAMPLE_PDF_BYTES = new TextEncoder().encode(SAMPLE_PDF).byteLength;

function delay(ms: number, signal: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('The user aborted a request.', 'AbortError'));
    }, { once: true });
  });
}

function binaryResponse(scenario: Scenario, kind: DocumentKind, disposition: 'attachment' | 'inline', signal: AbortSignal | null): Promise<Response> {
  const reference = scenario.reference ?? STORY_REFERENCE;
  const reply = scenario.binary ?? 'pdf';
  const build = (): Response => {
    if (typeof reply === 'object' && !('delayMs' in reply)) {
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(SAMPLE_PDF, { status: 200, headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(SAMPLE_PDF_BYTES),
      'Content-Disposition': `${disposition}; filename="ElectroHub-${reference}-${kind}.pdf"`,
    } });
  };
  if (typeof reply === 'object' && 'delayMs' in reply) return delay(reply.delayMs, signal).then(build);
  return Promise.resolve(build());
}

const storyAuthReply = (session: Session, url: URL): Reply | null => {
  if (url.pathname === '/api/auth/refresh') {
    if (session === 'signed-out') return fail(401, 'Unauthorized');
    if (session === 'unavailable') return fail(503, 'Unavailable');
    return ok({ accessToken: 'story-access-token' });
  }
  if (url.pathname === '/api/auth/me') return ok({ user: storyUser });
  return null;
};

function respond(scenario: Scenario, url: URL): Reply | 'pending' {
  const reference = scenario.reference ?? STORY_REFERENCE;
  const auth = storyAuthReply(scenario.session ?? 'signed-in', url);
  if (auth) return auth;
  if (url.pathname === '/api/orders') return ok(ordersPage([orderSummary(1, { orderReference: reference })], 1));
  if (url.pathname === `/api/orders/${encodeURIComponent(reference)}`) {
    return ok({ data: orderDetails({ orderReference: reference, ...scenario.order }) });
  }
  if (url.pathname === `/api/orders/${encodeURIComponent(reference)}/documents`) return metadataReply(scenario, reference);
  return fail(404, 'Not found');
}

/** Installs the scoped network stub before the providers' effects run, and restores the original fetch on unmount. */
function StubNetwork({ scenario }: { scenario: Scenario }) {
  useLayoutEffect(() => {
    const original = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      const kind = KINDS.find(candidate => url.pathname.endsWith(`/documents/${candidate}`));
      if (kind) {
        const disposition = url.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline';
        return binaryResponse(scenario, kind, disposition, init?.signal ?? null);
      }
      const reply = respond(scenario, url);
      if (reply === 'pending') return new Promise<Response>(() => undefined);
      return Promise.resolve(new Response(reply.body === undefined ? null : JSON.stringify(reply.body),
        { status: reply.status, headers: { 'Content-Type': 'application/json' } }));
    };
    return () => { window.fetch = original; };
  }, [scenario]);
  return null;
}

const identityKeys = ['electrohub:cached-user', 'electrohub:header-identity'];
/** Clears remembered identity so each story starts from a known session state. */
function clearStoredIdentity() {
  for (const key of identityKeys) {
    try { sessionStorage.removeItem(key); localStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
  }
}
const createStoryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });

/** Plain DOM play (no test utilities): waits for the control to render, then clicks it. Bounded so a broken story cannot hang. */
async function clickWhenReady(root: HTMLElement, selector: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const control = root.querySelector<HTMLButtonElement>(selector);
    if (control && !control.disabled) { control.click(); return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
const INVOICE_DOWNLOAD = 'button[aria-label^="Download Order invoice (non-tax) PDF"]';
const CHOOSER_TRIGGER = 'button[aria-label^="Documents for order"]';
const noScenario: Scenario = {};

function PanelSurface({ surface, orderReference }: { surface: Surface; orderReference: string }) {
  if (surface === 'chooser-dialog') return <OrderDocumentsChooser orderReference={orderReference} />;
  const variant = surface === 'details' || surface === 'chooser' ? surface : 'confirmation';
  return <div style={{ width: 'min(100%, 28rem)', padding: '1rem' }}>
    <OrderDocumentsPanel orderReference={orderReference} variant={variant} />
  </div>;
}

interface DocumentsStageProps { surface: Surface; scenario?: Scenario }

/**
 * Real AuthProvider plus the real panel, chooser or Orders pages behind a router. Each story gets its own QueryClient, which is
 * cleared on unmount, and the network stub is removed when the story leaves.
 */
function DocumentsStage({ surface, scenario = noScenario }: DocumentsStageProps) {
  const reference = scenario.reference ?? STORY_REFERENCE;
  const [client] = useState(() => { clearStoredIdentity(); return createStoryClient(); });
  useEffect(() => () => client.clear(), [client]);
  const path = surface === 'details-page' ? `/orders/${encodeURIComponent(reference)}` : surface === 'orders-page' ? '/orders' : '/documents';
  return <>
    <StubNetwork scenario={scenario} />
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:orderReference" element={<OrderDetailsPage />} />
            <Route path="*" element={<PanelSurface surface={surface} orderReference={reference} />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  </>;
}

const meta = {
  title: 'Customer/Order Documents',
  component: DocumentsStage,
  args: { surface: 'confirmation' },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DocumentsStage>;

export default meta;
type Story = StoryObj<typeof meta>;

const viewport = (name: 'mobile390' | 'tablet768' | 'desktop1440') => ({ viewport: { defaultViewport: name } });

// Confirmation / details panel states (deterministic synthetic metadata; server copy is unchanged)
export const PaidAllAvailable: Story = { args: { surface: 'confirmation', scenario: { metadata: ALL_AVAILABLE } } };
export const PendingSummaryOnly: Story = { args: { surface: 'confirmation', scenario: { metadata: { plan: PENDING, paidAt: null } } } };
/** Legacy order with no recorded payment (UNPROCESSED). Shown on the real details page so the order state is visible beside the panel. */
export const LegacyUnrecorded: Story = { args: { surface: 'details-page', scenario: {
  metadata: { plan: PENDING, paidAt: null },
  order: { paymentState: 'UNPROCESSED', card: null, payment: null },
} } };
export const FailedCancelled: Story = { args: { surface: 'details-page', scenario: {
  metadata: { plan: PENDING, paidAt: null },
  order: { status: 'CANCELLED', paymentState: 'FAILED', card: null, payment: { paidAt: null, refundedAt: null } },
} } };
export const PaidCancelled: Story = { args: { surface: 'details-page', scenario: {
  metadata: ALL_AVAILABLE,
  order: { status: 'CANCELLED', paymentState: 'PAID' },
} } };
export const RefundedProven: Story = { args: { surface: 'details-page', scenario: {
  metadata: ALL_AVAILABLE,
  order: { status: 'CANCELLED', paymentState: 'REFUNDED', payment: { paidAt: PAID_AT, refundedAt: '2026-09-06T09:30:00.000Z' } },
} } };
export const RefundedUnverified: Story = { args: { surface: 'details-page', scenario: {
  metadata: { plan: UNVERIFIED, paidAt: null },
  order: { status: 'CANCELLED', paymentState: 'REFUNDED', payment: { paidAt: null, refundedAt: '2026-09-06T09:30:00.000Z' } },
} } };
export const DataInconsistent: Story = { args: { surface: 'details', scenario: { metadata: { plan: INCONSISTENT } } } };

// Loading, errors and busy states
export const MetadataLoading: Story = { args: { surface: 'confirmation', scenario: { metadata: 'pending' } } };
export const MetadataError: Story = { args: { surface: 'confirmation', scenario: { metadata: { status: 500, body: { error: { code: 'STORY_ERROR', message: 'Internal failure' } } } } } };
export const BackendUnavailable: Story = { args: { surface: 'confirmation', scenario: { metadata: { status: 503, body: { error: { code: 'DOCUMENTS_UNAVAILABLE', message: 'Documents are temporarily unavailable.' } } } } } };
export const GeneratingSlow: Story = {
  args: { surface: 'confirmation', scenario: { metadata: ALL_AVAILABLE, binary: { delayMs: 30_000 } } },
  parameters: { docs: { description: { story: 'Clicks Download PDF on the invoice row. The binary response is delayed 30 seconds, so the busy state stays visible while the play function completes. Without the play function, click the invoice Download PDF button manually.' } } },
  play: ({ canvasElement }) => clickWhenReady(canvasElement, INVOICE_DOWNLOAD),
};
export const RateLimited: Story = {
  args: { surface: 'confirmation', scenario: { metadata: ALL_AVAILABLE, binary: { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Another document is being prepared. Please try again in a moment.' } } } } },
  parameters: { docs: { description: { story: 'Clicks Download PDF on the invoice row. The 429 JSON envelope puts the panel into its cooldown state.' } } },
  play: ({ canvasElement }) => clickWhenReady(canvasElement, INVOICE_DOWNLOAD),
};

// Chooser and long values
export const LongReference: Story = {
  args: { surface: 'chooser-dialog', scenario: { reference: LONG_REFERENCE, metadata: { plan: ALL, description: LONG_DESCRIPTION } } },
  parameters: { docs: { description: { story: 'Opens the My Orders chooser for a very long order reference and long metadata description to check wrapping in the dialog.' } } },
  play: ({ canvasElement }) => clickWhenReady(canvasElement, CHOOSER_TRIGGER),
};
export const ChooserOpen: Story = {
  args: { surface: 'chooser-dialog', scenario: { metadata: ALL_AVAILABLE } },
  play: ({ canvasElement }) => clickWhenReady(canvasElement, CHOOSER_TRIGGER),
};

// Real pages
export const OrderDetailsPageDocuments: Story = { args: { surface: 'details-page', scenario: { metadata: ALL_AVAILABLE } } };
export const OrdersPageChooser: Story = {
  args: { surface: 'orders-page', scenario: { metadata: ALL_AVAILABLE } },
  play: ({ canvasElement }) => clickWhenReady(canvasElement, CHOOSER_TRIGGER),
};

// Viewport variants for each panel variant (desktop 1440, tablet 768, mobile 390)
export const ConfirmationDesktop1440: Story = { args: { surface: 'confirmation' }, parameters: viewport('desktop1440') };
export const ConfirmationTablet768: Story = { args: { surface: 'confirmation' }, parameters: viewport('tablet768') };
export const ConfirmationMobile390: Story = { args: { surface: 'confirmation' }, parameters: viewport('mobile390') };
export const DetailsDesktop1440: Story = { args: { surface: 'details' }, parameters: viewport('desktop1440') };
export const DetailsTablet768: Story = { args: { surface: 'details' }, parameters: viewport('tablet768') };
export const DetailsMobile390: Story = { args: { surface: 'details' }, parameters: viewport('mobile390') };
export const ChooserDesktop1440: Story = { args: { surface: 'chooser' }, parameters: viewport('desktop1440') };
export const ChooserTablet768: Story = { args: { surface: 'chooser' }, parameters: viewport('tablet768') };
export const ChooserMobile390: Story = { args: { surface: 'chooser' }, parameters: viewport('mobile390') };
