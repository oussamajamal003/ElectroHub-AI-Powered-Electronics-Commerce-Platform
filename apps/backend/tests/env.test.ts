import { describe, expect, it } from 'vitest';
import { envDiagnostics } from '../src/config/env.js';

describe('Environment loading', () => {
  it('loads the isolated test environment file under NODE_ENV=test', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(envDiagnostics.selectedEnvFiles).toEqual(['.env', '.env.test.local']);
    expect(envDiagnostics.loadedEnvFiles).toContain('.env.test.local');
    expect(envDiagnostics.selectedEnvFiles).not.toContain('.env.local');
    expect(envDiagnostics.loadedEnvFiles).not.toContain('.env.local');
  });
});
