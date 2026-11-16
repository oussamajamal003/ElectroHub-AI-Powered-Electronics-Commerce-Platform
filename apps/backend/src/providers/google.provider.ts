import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const identitySchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().email().max(255).transform(value => value.trim().toLowerCase()),
  email_verified: z.literal(true),
  nonce: z.string(),
  given_name: z.string().max(100).optional(),
  family_name: z.string().max(100).optional(),
});

export interface GoogleIdentity {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
}

export class GoogleProvider {
  async verifyCode(code: string, verifier: string, nonce: string): Promise<GoogleIdentity> {
    const client = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
    let phase = 'exchange';
    try {
      const { tokens } = await client.getToken({ code, codeVerifier: verifier });
      phase = 'identity_validation';
      if (!tokens.id_token) throw new Error('Missing identity');
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
      const identity = identitySchema.parse(ticket.getPayload());
      if (identity.nonce !== nonce) throw new Error('Invalid nonce');
      return { sub: identity.sub, email: identity.email, firstName: identity.given_name || 'Customer', lastName: identity.family_name || '' };
    } catch (error) {
      const failureCode = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      const category = typeof failureCode === 'string' && ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ECONNREFUSED', 'ETIMEDOUT'].includes(failureCode) ? failureCode : 'PROVIDER_REJECTED';
      logger.warn('GOOGLE_PROVIDER_FAILED', { phase, category });
      throw new AppError('Google sign-in could not be completed. Please try again.', 400, 'GOOGLE_AUTH_FAILED');
    }
  }
}

export const googleProvider = new GoogleProvider();
