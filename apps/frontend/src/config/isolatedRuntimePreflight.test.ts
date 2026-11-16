import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runIsolatedRuntimePreflight } from '../../tests/isolated/global-setup';

const TOKEN = 'a'.repeat(64);
const ID = '123e4567-e89b-42d3-a456-426614174000';
const readTokenFile = vi.fn<(filePath: string) => Promise<string>>(async () => TOKEN);
const fetchMock = vi.fn<typeof fetch>();
let frontendUrl = 'http://127.0.0.1:3200';

function diagnostic(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ data: {
    mode: 'ISOLATED_QA', instanceId: ID, databaseReady: true, tlsVerified: true, ...overrides,
  } }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function runSetup() {
  await runIsolatedRuntimePreflight({
    readTokenFile,
    fetcher: fetchMock,
    environment: { ISOLATED_BASE_URL: frontendUrl },
  });
}

describe('isolated Playwright runtime preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frontendUrl = 'http://127.0.0.1:3200';
    readTokenFile.mockResolvedValue(TOKEN);
    fetchMock.mockImplementation(async () => diagnostic());
  });

  it('reads the private token from the backend isolated directory by default', async () => {
    await runSetup();

    expect(readTokenFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]apps[\\/]backend[\\/]\.isolated[\\/]runtime-token\.txt$/),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-isolated frontend origin before making any network request', async () => {
    frontendUrl = 'http://127.0.0.1:3000';

    await expect(runSetup()).rejects.toThrow(/local :3200 frontend/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readTokenFile).not.toHaveBeenCalled();
  });

  it('fails closed when the token file is missing or the token is malformed', async () => {
    readTokenFile.mockRejectedValueOnce(new Error('missing'));
    await expect(runSetup()).rejects.toThrow(/token file is missing or unreadable/);
    expect(fetchMock).not.toHaveBeenCalled();

    readTokenFile.mockResolvedValueOnce('not-a-token');
    await expect(runSetup()).rejects.toThrow(/private runtime token is invalid/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a refused diagnostic response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));

    await expect(runSetup()).rejects.toThrow(/diagnostic was refused/);
  });

  it('rejects a runtime that does not attest verified TLS', async () => {
    fetchMock.mockResolvedValueOnce(diagnostic({ tlsVerified: false }));

    await expect(runSetup()).rejects.toThrow(/do not attest the same ready disposable runtime/);
  });

  it('rejects when the direct API and frontend proxy report different instances', async () => {
    fetchMock.mockResolvedValueOnce(diagnostic());
    fetchMock.mockResolvedValueOnce(diagnostic({ instanceId: '123e4567-e89b-42d3-a456-426614174001' }));

    await expect(runSetup()).rejects.toThrow(/do not attest the same ready disposable runtime/);
  });

  it('passes when direct API and frontend proxy attest the same ready runtime', async () => {
    await expect(runSetup()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:5200/api/internal/development-runtime', expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3200/api/internal/development-runtime', expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
    }));
  });
});
