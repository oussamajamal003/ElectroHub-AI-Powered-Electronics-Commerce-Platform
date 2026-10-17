import { describe, expect, it } from 'vitest';
import { envDiagnostics, validateEnvironment } from '../src/config/env.js';

describe('Environment loading', () => {
  it('loads the isolated test environment file under NODE_ENV=test', () => {
    expect(envDiagnostics.selectedEnvFiles).toEqual(['.env', '.env.test.local']);
    expect(envDiagnostics.loadedEnvFiles).toContain('.env.test.local');
    expect(envDiagnostics.selectedEnvFiles).not.toContain('.env.local');
    expect(envDiagnostics.loadedEnvFiles).not.toContain('.env.local');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['short', 'short-test-secret'],
    ['known development fallback', 'dev_secret_key_change_me_in_prod'],
    ['placeholder', 'REPLACE_WITH_A_UNIQUE_RANDOM_VALUE_OF_AT_LEAST_32_CHARACTERS'],
    ['low diversity', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ])('rejects a %s JWT signing secret', (_label, secret) => {
    const source = validEnvironment();
    if (secret === undefined) delete source.JWT_SECRET;
    else source.JWT_SECRET = secret;

    expect(() => validateEnvironment(source)).toThrow(/JWT_SECRET/);
  });

  it('accepts a strong configured JWT signing secret', () => {
    const validated = validateEnvironment(validEnvironment());
    expect(validated.JWT_SECRET).toBe(validEnvironment().JWT_SECRET);
  });
});

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/electrohub',
    DIRECT_URL: 'postgresql://test:test@localhost:5432/electrohub',
    JWT_SECRET: 'c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605',
  };
}
