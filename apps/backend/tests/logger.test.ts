import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { logger } from '../src/utils/logger.js';
import Transport from 'winston-transport';

class TestTransport extends Transport {
  public logOutput: Record<string, unknown>[] = [];
  log(info: Record<string, unknown>, callback: () => void) {
    this.logOutput.push(info);
    callback();
  }
}

describe('Logger', () => {
  let testTransport: TestTransport;

  beforeEach(() => {
    testTransport = new TestTransport();
    logger.add(testTransport);
  });

  afterEach(() => {
    logger.remove(testTransport);
  });

  it('should initialize successfully as a singleton', () => {
    expect(logger).toBeDefined();
    // Test that it's a winston logger
    expect(logger).toHaveProperty('info');
    expect(logger).toHaveProperty('error');
  });

  it('should log structured data without throwing', () => {
    expect(() => {
      logger.info('Test log event', {
        event: 'test.event',
        detail: 'structured data',
      });
    }).not.toThrow();
    
    expect(testTransport.logOutput.length).toBeGreaterThan(0);
    const lastLog = testTransport.logOutput[testTransport.logOutput.length - 1];
    
    expect(lastLog.message).toBe('Test log event');
    expect(lastLog.event).toBe('test.event');
    expect(lastLog.detail).toBe('structured data');
    expect(lastLog.level).toContain('info');
  });

  it('should log errors properly', () => {
    const errorMsg = 'Something went wrong';
    logger.error(errorMsg, { error: new Error('Critical failure').message });
    
    expect(testTransport.logOutput.length).toBeGreaterThan(0);
    const lastLog = testTransport.logOutput[testTransport.logOutput.length - 1];
    
    expect(lastLog.level).toContain('error');
    expect(lastLog.message).toBe(errorMsg);
    expect(lastLog.error).toBe('Critical failure');
  });
  
  it('should not expose secrets implicitly if they are not passed to it', () => {
    // The logger only logs what it is given.
    logger.info('User login', { username: 'testuser' });
    const lastLog = testTransport.logOutput[testTransport.logOutput.length - 1];
    
    expect(lastLog.message).toBe('User login');
    expect(lastLog.username).toBe('testuser');
    expect(lastLog).not.toHaveProperty('password');
  });
});
