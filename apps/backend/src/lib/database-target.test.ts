import { describe, expect, it } from 'vitest';
import { DEV_PROJECT, PROD_PROJECT, describeDatabaseTarget, resolveDatabaseTargets } from './database-target.js';

const direct = (project = DEV_PROJECT) => `postgresql://postgres:private@db.${project}.supabase.co:5432/postgres?sslmode=require`;
const pooled = (port = 5432, project = DEV_PROJECT) => `postgresql://postgres.${project}:private@aws-0-ap-northeast-2.pooler.supabase.com:${port}/postgres`;
const local = 'postgresql://postgres:private@localhost:55434/electrohub_disposable';
const env = (patch: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ NODE_ENV: 'development', DATABASE_URL: pooled(), DIRECT_URL: direct(), ...patch });

describe('logical database target and explicit runtime selection', () => {
  it('recognizes direct and session endpoints of the same project without exposing credentials', () => {
    const result = resolveDatabaseTargets(env());
    expect(result.runtime.transport).toBe('session-pooler');
    expect(result.runtime.identity).toBe(result.migration.identity);
    expect(JSON.stringify(result.runtime)).not.toContain('private');
  });
  it('uses DATABASE_URL by default and only explicitly selects DIRECT_URL', () => {
    expect(resolveDatabaseTargets(env()).runtimeUrl).toBe(pooled());
    expect(resolveDatabaseTargets(env({ DB_RUNTIME_URL_SOURCE: 'direct' })).runtimeUrl).toBe(direct());
    expect(resolveDatabaseTargets(env({ DATABASE_URL: `${pooled()}?sslrootcert=trusted-ca.pem` })).runtime.transport).toBe('session-pooler');
  });
  it('refuses a transaction pooler at runtime rather than silently changing connections', () => {
    expect(() => resolveDatabaseTargets(env({ DATABASE_URL: pooled(6543) }))).toThrow('DATABASE_SESSION_CONNECTION_REQUIRED');
    expect(resolveDatabaseTargets(env({ DATABASE_URL: pooled(6543), DB_RUNTIME_URL_SOURCE: 'direct' })).runtime.transport).toBe('direct');
  });
  it('allows only a matching disposable pair in test mode', () => {
    expect(resolveDatabaseTargets(env({ NODE_ENV: 'test', DATABASE_URL: local, DIRECT_URL: local })).runtime.category).toBe('disposable');
    expect(() => resolveDatabaseTargets(env({ NODE_ENV: 'test' }))).toThrow('DATABASE_TEST_TARGET_REQUIRED');
    expect(() => resolveDatabaseTargets(env({ DATABASE_URL: local }))).toThrow('DATABASE_TARGET_MISMATCH');
  });
  it('permits the CI CLI TLS override only for a test-mode loopback disposable pair', () => {
    const ci = 'postgresql://postgres:private@localhost:55432/electrohub_ci?sslmode=disable';
    expect(() => describeDatabaseTarget(ci)).toThrow('DATABASE_TLS_REQUIRED');
    expect(resolveDatabaseTargets(env({ NODE_ENV: 'test', DATABASE_URL: ci, DIRECT_URL: ci })).runtime.category).toBe('disposable');
    expect(() => resolveDatabaseTargets(env({ DATABASE_URL: ci, DIRECT_URL: ci }))).toThrow('DATABASE_TLS_REQUIRED');
    const remote = direct().replace('sslmode=require', 'sslmode=disable');
    expect(() => resolveDatabaseTargets(env({ NODE_ENV: 'test', DATABASE_URL: remote, DIRECT_URL: remote }))).toThrow('DATABASE_TLS_REQUIRED');
  });
  it('does not confuse two different disposable databases or ports', () => {
    for (const DIRECT_URL of [local.replace('55434', '55435'), local.replace('electrohub_disposable', 'electrohub_ci')]) {
      expect(() => resolveDatabaseTargets(env({ DATABASE_URL: local, DIRECT_URL }))).toThrow('DATABASE_TARGET_MISMATCH');
    }
  });
  it('accepts the Prisma public schema only, so URL pairs cannot select different datasets', () => {
    for (const value of [local, pooled(), direct()]) {
      const separator = value.includes('?') ? '&' : '?';
      expect(describeDatabaseTarget(`${value}${separator}schema=public`).identity).toBe(describeDatabaseTarget(value).identity);
      expect(() => describeDatabaseTarget(`${value}${separator}schema=other`)).toThrow('DATABASE_SCHEMA_UNAPPROVED');
    }
  });
  it('restricts production identity to production mode and preserves its explicit runtime choice', () => {
    const production = { DATABASE_URL: pooled(5432, PROD_PROJECT), DIRECT_URL: direct(PROD_PROJECT) };
    expect(() => resolveDatabaseTargets(env(production))).toThrow('DATABASE_PRODUCTION_FORBIDDEN');
    expect(resolveDatabaseTargets(env({ ...production, NODE_ENV: 'production' })).runtime.category).toBe('production');
    expect(() => resolveDatabaseTargets(env({ NODE_ENV: 'production' }))).toThrow('DATABASE_PRODUCTION_TARGET_REQUIRED');
    expect(() => resolveDatabaseTargets(env({ DIRECT_URL: direct(PROD_PROJECT) }))).toThrow('DATABASE_TARGET_MISMATCH');
  });
  it.each([
    undefined, '', 'bad-url-private', 'https://localhost/electrohub_disposable',
    local.replace('localhost', 'db.example.com'), local.replace('electrohub_disposable', 'postgres'),
    direct('aaaaaaaaaaaaaaaaaaaa'), direct().replace('postgres:private', 'postgres.other:private'),
    `${pooled()}?host=db.example.com`, `${pooled()}?sslmode=no-verify`, `${local}?sslmode=disable`,
    `${local}?sslmode=require&sslmode=disable`, `${pooled()}?ssl=false`,
  ])('rejects invalid or unapproved targets without including the input in errors', value => {
    expect(() => describeDatabaseTarget(value)).toThrow(/^DATABASE_/);
    try { describeDatabaseTarget(value); } catch (error) { expect(String(error)).not.toContain('private'); }
  });
  it('refuses insecure global TLS and invalid selection', () => {
    expect(() => resolveDatabaseTargets(env({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }))).toThrow('DATABASE_TLS_REQUIRED');
    expect(() => resolveDatabaseTargets(env({ DB_RUNTIME_URL_SOURCE: 'fallback' }))).toThrow('DATABASE_RUNTIME_SOURCE_INVALID');
  });
});
