import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';

const original = { ...env };
afterEach(() => Object.assign(env, original));

describe('Google local callback configuration', () => {
  const configure = () => {
    env.NODE_ENV = 'development';
    env.PORT = 5000;
    env.FRONTEND_URL = 'http://localhost:3000';
    env.GOOGLE_REDIRECT_URI = 'http://localhost:5000/api/auth/google/callback';
    env.GOOGLE_CLIENT_ID = 'test-client';
    env.GOOGLE_CLIENT_SECRET = 'test-secret';
    env.JWT_SECRET = 'test-cookie-signing-secret';
  };

  it('authorizes the canonical local backend callback and preserves the opener', async () => {
    configure();
    const response = await request(app).get('/api/auth/google/start').expect(302);
    expect(new URL(response.headers.location).searchParams.get('redirect_uri')).toBe(env.GOOGLE_REDIRECT_URI);
    expect(response.headers['cross-origin-opener-policy']).toBe('unsafe-none');
  });

  it('rejects a different callback origin in production', async () => {
    configure();
    env.NODE_ENV = 'production';
    const response = await request(app).get('/api/auth/google/start').expect(303);
    expect(response.headers.location).toBe('http://localhost:3000/api/auth/google/complete');
  });

  it('returns a sanitized failure without state or cookies', async () => {
    configure();
    const response = await request(app).get('/api/auth/google/callback').expect(303);
    expect(response.headers.location).toBe('http://localhost:3000/api/auth/google/complete');
    expect(response.text).not.toMatch(/Prisma|GOOGLE_CLIENT_SECRET|stack trace/);
    expect(response.headers['cross-origin-opener-policy']).toBe('unsafe-none');
  });

  it('requires a signed completion cookie rather than trusting a status query', async () => {
    configure();
    const response = await request(app).get('/api/auth/google/complete?status=success').expect(200);
    expect(response.text).toContain('"status":"failure"');
  });

  it('binds cancellation completion to the signed transaction channel', async () => {
    configure();
    const agent = request.agent(app);
    const channel = 'cdf18750-8cbd-4f96-bf6d-87c6a7267ae4';
    const start = await agent.get(`/api/auth/google/start?channel=${channel}`).expect(302);
    const state = new URL(start.headers.location).searchParams.get('state');
    await agent.get('/api/auth/google/callback').query({ state, error: 'access_denied' }).expect(303);
    const completion = await agent.get('/api/auth/google/complete').expect(200);
    expect(completion.text).toContain('"status":"cancelled"');
    expect(completion.text).toContain(`electrohub-google-${channel}`);
    const replay = await agent.get('/api/auth/google/complete').expect(200);
    expect(replay.text).toContain('"status":"failure"');
  });
});
