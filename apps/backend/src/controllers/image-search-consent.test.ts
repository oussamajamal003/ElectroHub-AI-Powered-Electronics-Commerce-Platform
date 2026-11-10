import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mocks = vi.hoisted(() => ({ search: vi.fn(), completed: vi.fn(), failed: vi.fn(), token: vi.fn(() => 'signed') }));
vi.mock('../services/image-search.service.js', () => ({ IMAGE_SEARCH_DEFAULT_LIMIT: 10, IMAGE_SEARCH_MAX_LIMIT: 20,
  ImageSearchError: class extends Error {}, imageSearchService: { search: mocks.search } }));
vi.mock('../middleware/imageSearchAdmission.js', () => ({ imageSearchLifecycle: () => undefined }));
vi.mock('../services/analytics-events.service.js', () => ({ recordImageSearchCompleted: mocks.completed, recordImageSearchFailed: mocks.failed }));
vi.mock('../services/analytics-token.js', () => ({ issueAnalyticsToken: mocks.token }));
import { imageSearchController } from './image-search.controller.js';

async function run(consented: boolean) {
  const req = { get: () => consented ? 'consented' : undefined, id: 'test' } as unknown as Request;
  const response = { locals: { sniffedImage: { buffer: Buffer.from('image'), contentType: 'image/png' }, imageSearchLimit: 10 },
    once: vi.fn(), off: vi.fn(), setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), writableFinished: false, writableEnded: false };
  response.status.mockReturnValue(response);
  await imageSearchController.search(req, response as unknown as Response, vi.fn() as NextFunction);
  return response;
}
describe('image search analytics consent', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.search.mockResolvedValue({ meta: { count: 1 }, data: { items: [{ id: 'product' }] } }); });
  it('does not record or issue a token without opt-in', async () => {
    const res = await run(false);
    expect(mocks.completed).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('analyticsToken');
  });
  it('records and issues a token when opted in', async () => {
    const res = await run(true);
    expect(mocks.completed).toHaveBeenCalledOnce();
    expect(res.json.mock.calls[0][0]).toHaveProperty('analyticsToken', 'signed');
  });
  it('does not record failed searches without opt-in', async () => {
    mocks.search.mockRejectedValue(new Error('offline'));
    await run(false);
    expect(mocks.failed).not.toHaveBeenCalled();
  });
});
