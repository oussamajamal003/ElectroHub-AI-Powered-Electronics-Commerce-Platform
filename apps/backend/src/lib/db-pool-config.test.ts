import { describe, expect, it } from 'vitest';
import { resolveDbPoolMax } from './db-pool-config.js';

describe('resolveDbPoolMax', () => {
  it('keeps defaults when unset or blank', () => {
    expect(resolveDbPoolMax(undefined)).toBeUndefined();
    expect(resolveDbPoolMax('   ')).toBeUndefined();
  });

  it('accepts integers from 1 to 10', () => {
    expect(resolveDbPoolMax('2')).toBe(2);
    expect(resolveDbPoolMax(' 10 ')).toBe(10);
  });

  it.each(['0', '-1', '2.5', '11', 'abc', '1e1'])('rejects %s', value => {
    expect(() => resolveDbPoolMax(value)).toThrow('DB_POOL_MAX must be an integer from 1 to 10');
  });
});
