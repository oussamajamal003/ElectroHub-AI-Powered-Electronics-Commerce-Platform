import { Router } from 'express';
import {
  register,
  login,
  refresh,
  logout,
  getCurrentUser,
  updateProfile,
  forgotPassword,
  resetPassword,
  changePassword,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import {
  loginRateLimiter,
  registerRateLimiter,
  passwordResetRateLimiter,
} from '../middleware/rateLimiter.js';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: User authentication, registration, and session management
 */

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new customer account
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *     responses:
 *       201:
 *         description: Registration successful
 *       400:
 *         description: Validation failed or email already registered
 *       429:
 *         description: Too many registration attempts
 */
router.post('/register', registerRateLimiter, register);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login and receive access and refresh tokens
 *     description: Returns an access token in the JSON body and sets a refresh token in an HttpOnly cookie.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many login attempts
 */
router.post('/login', loginRateLimiter, login);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     description: Requires a valid refresh token in the `electrohub_refresh` HttpOnly cookie. Rotates the refresh token.
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Successfully refreshed access token
 *       401:
 *         description: Refresh token missing, invalid, or expired
 *       429:
 *         description: Too many refresh attempts
 */
router.post('/refresh', refresh);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Request a password reset
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: If the account exists, a password reset message has been sent.
 *       400:
 *         description: Validation failed
 *       429:
 *         description: Too many requests
 */
router.post('/forgot-password', passwordResetRateLimiter, forgotPassword);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password using a reset token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password has been reset successfully.
 *       400:
 *         description: Invalid or expired reset token, or validation failed
 *       429:
 *         description: Too many requests
 */
router.post('/reset-password', passwordResetRateLimiter, resetPassword);

// Protected routes (requires valid access token)

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout and revoke refresh token
 *     description: Clears the `electrohub_refresh` cookie.
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       401:
 *         description: Unauthenticated
 */
router.post('/logout', logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current authenticated user details
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved user details
 *       401:
 *         description: Unauthenticated or user not found
 */
router.get('/me', requireAuth, getCurrentUser);

/**
 * @swagger
 * /auth/me:
 *   patch:
 *     summary: Update current authenticated user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully updated profile
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Unauthenticated
 */
router.patch('/me', requireAuth, updateProfile);

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Change current user password
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Validation failed or incorrect current password
 *       401:
 *         description: Unauthenticated
 */
router.post('/change-password', requireAuth, changePassword);

// Example of an admin-only route structure (for future use/testing RBAC)
// router.get('/admin-only', requireAuth, requireRole('ADMINISTRATOR'), someAdminHandler);

export default router;
