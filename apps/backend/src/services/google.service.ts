import { GoogleRepository } from '../repositories/google.repository.js';
import { GoogleIdentity } from '../providers/google.provider.js';
import { AuthService } from './auth.service.js';
import { verifyPassword } from '../utils/hash.js';
import { AppError } from '../middleware/errorHandler.js';

const conflict = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

export class GoogleService {
  constructor(private repository = new GoogleRepository(), private auth = new AuthService()) {}

  async signIn(identity: GoogleIdentity) {
    const linked = await this.repository.findIdentity(identity.sub);
    if (linked) return this.session(linked.user.id);
    if (await this.repository.findUser(identity.email)) return { linkingRequired: true as const };
    try {
      const user = await this.repository.createCustomer(identity);
      return this.session(user.id);
    } catch (error) {
      if (!conflict(error)) throw error;
      const winner = await this.repository.findIdentity(identity.sub);
      if (winner) return this.session(winner.user.id);
      if (await this.repository.findUser(identity.email)) return { linkingRequired: true as const };
      throw new AppError('Google sign-in could not be completed. Please try again.', 409, 'GOOGLE_CONFLICT');
    }
  }

  async link(identity: GoogleIdentity, password: string) {
    const user = await this.repository.findUser(identity.email);
    if (!user || user.email !== identity.email || !user.isActive || !user.emailVerifiedAt || user.role.name !== 'CUSTOMER' || !user.passwordHash || !await verifyPassword(password, user.passwordHash)) {
      throw new AppError('Unable to connect Google. Check your account password and verified email.', 400, 'GOOGLE_LINK_FAILED');
    }
    const linked = await this.repository.findIdentity(identity.sub);
    if (linked && linked.userId !== user.id) throw new AppError('Unable to connect this Google account.', 409, 'GOOGLE_LINK_CONFLICT');
    if (!linked) {
      try {
        if (!await this.repository.connect(user.id, identity, user.passwordHash)) throw new AppError('Unable to connect Google. Please sign in again.', 400, 'GOOGLE_LINK_FAILED');
      } catch (error) {
        if (!conflict(error)) throw error;
        const winner = await this.repository.findIdentity(identity.sub);
        if (!winner || winner.userId !== user.id) throw new AppError('Unable to connect this Google account.', 409, 'GOOGLE_LINK_CONFLICT');
      }
    }
    return this.session(user.id);
  }

  async verifyDeletionIdentity(userId: string, subject: string) {
    const linked = await this.repository.findIdentity(subject);
    if (!linked || linked.user.id !== userId || !linked.user.isActive || linked.user.role.name !== 'CUSTOMER') {
      throw new AppError('The Google account does not match this ElectroHub account.', 403, 'ACCOUNT_REAUTH_IDENTITY_MISMATCH');
    }
  }

  private async session(userId: string) {
    let result;
    try { result = await this.auth.establishCustomerSession(userId); }
    catch (error) {
      if (error instanceof Error && error.message === 'Invalid credentials') throw new AppError('Google sign-in is unavailable for this account.', 403, 'GOOGLE_ACCOUNT_UNAVAILABLE');
      throw error;
    }
    await this.repository.recordLogin(userId);
    return result;
  }
}
