import { describe, expect, it } from 'vitest';
import { getFrontendServerConfig, getViteServerConfig } from './viteServerConfig';

describe('getFrontendServerConfig', () => {
  it('keeps normal DEV on :3000 → :5000 with strict port binding', () => {
    expect(getFrontendServerConfig({})).toEqual({
      port: 3000,
      strictPort: true,
      proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } },
    });
  });

  it('defaults isolated QA on :3200 → :5200 and accepts loopback aliases', () => {
    expect(getFrontendServerConfig({ E2E_FRONTEND_PORT: '3200' }).proxy['/api'].target).toBe('http://localhost:5200');
    expect(getFrontendServerConfig({ E2E_FRONTEND_PORT: '3200', E2E_API_PROXY_TARGET: 'http://127.0.0.1:5200' }).proxy['/api'].target)
      .toBe('http://127.0.0.1:5200');
  });

  it('preserves non-reserved frontend/backend pairs used by focused test servers', () => {
    expect(getFrontendServerConfig({ E2E_FRONTEND_PORT: '3136', E2E_API_PROXY_TARGET: 'http://127.0.0.1:5136' }).proxy['/api'].target)
      .toBe('http://127.0.0.1:5136');
  });

  it('uses CLI port overrides for existing test servers', () => {
    expect(getFrontendServerConfig({ E2E_API_PROXY_TARGET: 'http://127.0.0.1:5136' }, ['node', 'vite', '--port', '3136']).port).toBe(3136);
    expect(getFrontendServerConfig({ E2E_API_PROXY_TARGET: 'http://127.0.0.1:5136' }, ['node', 'vite', '--port=3136']).proxy['/api'].target)
      .toBe('http://127.0.0.1:5136');
  });

  it('selects the isolated default backend for a CLI-selected :3200 frontend', () => {
    expect(getFrontendServerConfig({}, ['node', 'vite', '--port', '3200']).proxy['/api'].target).toBe('http://localhost:5200');
  });

  it('rejects conflicting environment and CLI frontend ports', () => {
    expect(() => getFrontendServerConfig({ E2E_FRONTEND_PORT: '3000' }, ['node', 'vite', '--port', '3200'])).toThrow(/must agree/);
  });

  it('does not validate or attach server proxy configuration during builds', () => {
    expect(getViteServerConfig('build', { E2E_FRONTEND_PORT: 'invalid', E2E_API_PROXY_TARGET: 'https://example.com' })).toBeUndefined();
  });

  it.each([
    { E2E_FRONTEND_PORT: '3000', E2E_API_PROXY_TARGET: 'http://localhost:5200' },
    { E2E_FRONTEND_PORT: '3200', E2E_API_PROXY_TARGET: 'http://localhost:5000' },
    { E2E_FRONTEND_PORT: '3200', E2E_API_PROXY_TARGET: 'https://localhost:5200' },
    { E2E_FRONTEND_PORT: '3200', E2E_API_PROXY_TARGET: 'http://user:pass@localhost:5200' },
    { E2E_FRONTEND_PORT: '3200', E2E_API_PROXY_TARGET: 'http://example.com:5200' },
    { E2E_FRONTEND_PORT: '3200', E2E_API_PROXY_TARGET: 'http://localhost:5200/api' },
    { E2E_FRONTEND_PORT: 'bad' },
  ])('rejects unsafe or mismatched environment: $E2E_FRONTEND_PORT $E2E_API_PROXY_TARGET', environment => {
    expect(() => getFrontendServerConfig(environment)).toThrow();
  });
});
