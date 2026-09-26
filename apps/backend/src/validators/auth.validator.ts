import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
}).strict();

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
}).strict();

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const verifyResetOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, 'Verification code must be exactly 6 digits').regex(/^\d+$/, 'Code must contain only digits'),
}).strict();

export const resetPasswordSchema = z.object({
  resetToken: z.string().min(32, 'Reset authorization is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters long'),
}).strict();

export const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, 'Verification code must be exactly 6 digits').regex(/^\d+$/, 'Code must contain only digits'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email(),
});

export const changeVerificationEmailSchema = z.object({
  currentEmail: z.string().email(),
  password: z.string().min(1),
  newEmail: z.string().email(),
}).strict();

export const updateProfileSchema = z.object({
  firstName: z.string().min(1, 'First name cannot be empty').max(100, 'First name is too long').optional(),
  lastName: z.string().min(1, 'Last name cannot be empty').max(100, 'Last name is too long').optional(),
  email: z.string().email().optional(),
}).strict();

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters long'),
}).strict();
