import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import * as jwtUtils from '../../utils/jwt.js';

// Mock the jwt utils
vi.mock('../../utils/jwt.js', () => ({
  verifyAccessToken: vi.fn(),
}));

describe('Auth Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    nextFunction = vi.fn();
    vi.clearAllMocks();
  });

  describe('requireAuth', () => {
    it('should return 401 if no authorization header is present', () => {
      requireAuth(mockReq as Request, mockRes as Response, nextFunction);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthenticated' });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should return 401 if token is invalid', () => {
      mockReq.headers = { authorization: 'Bearer invalid_token' };
      vi.mocked(jwtUtils.verifyAccessToken).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      requireAuth(mockReq as Request, mockRes as Response, nextFunction);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should set req.user and call next if token is valid', () => {
      mockReq.headers = { authorization: 'Bearer valid_token' };
      const payload = { userId: '123', role: 'CUSTOMER' };
      vi.mocked(jwtUtils.verifyAccessToken).mockReturnValue(payload);

      requireAuth(mockReq as Request, mockRes as Response, nextFunction);

      expect(mockReq.user).toEqual(payload);
      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('requireRole', () => {
    it('should return 401 if user is not authenticated', () => {
      const middleware = requireRole('ADMIN');
      middleware(mockReq as Request, mockRes as Response, nextFunction);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthenticated' });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should return 403 if user role does not match (e.g. authenticated CUSTOMER accessing ADMIN route)', () => {
      mockReq.user = { userId: '123', role: 'CUSTOMER' };
      
      const middleware = requireRole('ADMIN');
      middleware(mockReq as Request, mockRes as Response, nextFunction);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Forbidden: Insufficient permissions' });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should call next if user has correct ADMIN role', () => {
      mockReq.user = { userId: '123', role: 'ADMIN' };
      
      const middleware = requireRole('ADMIN');
      middleware(mockReq as Request, mockRes as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });
});
