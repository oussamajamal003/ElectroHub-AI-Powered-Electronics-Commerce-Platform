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
  verifyResetOtp,
  changePassword,
  verifyEmail,
  resendVerification,
  changeVerificationEmail,
  verifyPendingEmailChange,
  resendPasswordReset,
  resendPendingEmailChange,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import {
  loginRateLimiter,
  registerRateLimiter,
  passwordResetRateLimiter,
  resendVerificationRateLimiter,
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
 * /auth/verify-email:
 *   post:
 *     summary: Verify email using a verification code
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - code
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired verification code
 *       429:
 *         description: Too many requests
 * 
 * /auth/resend-verification:
 *   post:
 *     summary: Resend email verification code
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
 *         description: Generic acknowledgement regardless of account existence
 *       400:
 *         description: Invalid request
 *       429:
 *         description: IP request limit reached; challenge cooldown returns a generic acknowledgement
 */
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerificationRateLimiter, resendVerification);

/**
 * @swagger
 * /auth/change-verification-email:
 *   post:
 *     summary: Correct the address on an unverified customer account
 *     description: Requires the current email and password. Responses are generic; the new address remains unverified until its OTP is consumed.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentEmail, password, newEmail]
 *             properties:
 *               currentEmail: { type: string, format: email }
 *               password: { type: string }
 *               newEmail: { type: string, format: email }
 *     responses:
 *       200: { description: Generic acknowledgement; verification remains required }
 *       400: { description: Invalid request }
 *       429: { description: Request limit reached }
 */
router.post('/change-verification-email', resendVerificationRateLimiter, changeVerificationEmail);

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
 *         description: If an account exists, you may receive password reset instructions shortly.
 *       400:
 *         description: Validation failed
 *       429:
 *         description: Too many requests
 */
router.post('/forgot-password', passwordResetRateLimiter, forgotPassword);

/**
 * @swagger
 * /auth/resend-password-reset:
 *   post:
 *     summary: Resend a password reset OTP
 *     description: Uses the PASSWORD_RESET purpose and an enumeration-safe response.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Generic acknowledgement }
 *       400: { description: Invalid request }
 *       429: { description: Request limit reached }
 */
router.post('/resend-password-reset', passwordResetRateLimiter, resendPasswordReset);

/**
 * @swagger
 * /auth/verify-reset-otp:
 *   post:
 *     summary: Verify a password reset OTP and issue a reset authorization
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email: { type: string, format: email }
 *               code: { type: string, pattern: '^[0-9]{6}$' }
 *     responses:
 *       200: { description: OTP consumed; returns a ten-minute single-use reset authorization }
 *       400: { description: Invalid or expired code }
 *       429: { description: Request limit reached }
 */
router.post('/verify-reset-otp', passwordResetRateLimiter, verifyResetOtp);

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
 *               - resetToken
 *               - newPassword
 *             properties:
 *               resetToken:
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName: { type: string, maxLength: 100 }
 *               lastName: { type: string, maxLength: 100 }
 *               email: { type: string, format: email, description: New address remains pending until verified }
 *     responses:
 *       200:
 *         description: Successfully updated profile
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Unauthenticated
 *       409:
 *         description: Email already registered
 *       429:
 *         description: Profile update rate limit reached
 */
router.patch('/me', requireAuth, resendVerificationRateLimiter, updateProfile);

/**
 * @swagger
 * /auth/me/verify-email-change:
 *   post:
 *     summary: Verify a pending profile email change
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, pattern: '^[0-9]{6}$' }
 *     responses:
 *       200: { description: Email promoted and EMAIL_CHANGED event recorded }
 *       400: { description: Invalid or expired code }
 *       401: { description: Unauthenticated }
 */
router.post('/me/verify-email-change', requireAuth, verifyPendingEmailChange);

/**
 * @swagger
 * /auth/me/resend-email-change:
 *   post:
 *     summary: Resend the pending profile email change OTP
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Verification code resent }
 *       400: { description: No pending email change }
 *       401: { description: Unauthenticated }
 *       429: { description: Resend cooldown or request limit reached }
 */
router.post('/me/resend-email-change', requireAuth, resendVerificationRateLimiter, resendPendingEmailChange);

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
