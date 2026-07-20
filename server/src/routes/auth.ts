import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { config } from '../config';
import { ApiError, asyncHandler } from '../errors';
import { requireAuth, currentUserId } from '../auth/middleware';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  hashToken,
} from '../auth/tokens';
import { isSupportedCurrency } from '../money/currency';

export const authRouter = Router();

// Credential endpoints get a tight limit — this is where password guessing and
// account enumeration happen.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
  skip: () => config.NODE_ENV === 'test',
});

const currencySchema = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase())
  .refine(isSupportedCurrency, 'Unsupported currency');

const signupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  defaultCurrency: currencySchema.optional(),
});

const publicUser = (u: {
  id: string; name: string; email: string; avatarUrl: string | null; defaultCurrency: string;
}) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatarUrl: u.avatarUrl,
  defaultCurrency: u.defaultCurrency,
});

authRouter.post(
  '/signup',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = signupSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new ApiError(409, 'An account with that email already exists');
    }

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: await bcrypt.hash(body.password, 12),
        defaultCurrency: body.defaultCurrency ?? 'USD',
      },
    });

    res.status(201).json({
      user: publicUser(user),
      accessToken: signAccessToken({ sub: user.id, email: user.email }),
      refreshToken: await issueRefreshToken(user.id),
    });
  }),
);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    // Hash even when the user does not exist, so response timing does not
    // reveal which emails are registered.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const valid = await bcrypt.compare(body.password, hash);

    if (!user || !valid) {
      throw new ApiError(401, 'Incorrect email or password');
    }

    res.json({
      user: publicUser(user),
      accessToken: signAccessToken({ sub: user.id, email: user.email }),
      refreshToken: await issueRefreshToken(user.id),
    });
  }),
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body);
    const rotated = await rotateRefreshToken(body.refreshToken);

    if (!rotated) {
      throw new ApiError(401, 'Invalid or expired refresh token');
    }

    const user = await prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user) throw new ApiError(401, 'Account no longer exists');

    res.json({
      accessToken: signAccessToken({ sub: user.id, email: user.email }),
      refreshToken: rotated.refreshToken,
    });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body);
    await revokeRefreshToken(body.refreshToken);
    res.status(204).send();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: currentUserId(req) } });
    if (!user) throw new ApiError(404, 'User not found');
    res.json({ user: publicUser(user) });
  }),
);

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  defaultCurrency: currencySchema.optional(),
});

authRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = updateProfileSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: currentUserId(req) },
      data: body,
    });
    res.json({ user: publicUser(user) });
  }),
);

// --- Password reset -----------------------------------------------------

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email() });

authRouter.post(
  '/forgot-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = forgotSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      // TODO(email): hand this to the mailer once transactional email is wired
      // up. Logging it keeps the flow testable in development.
      if (config.NODE_ENV !== 'production') {
        console.log(`[dev] Password reset token for ${user.email}: ${token}`);
      }
    }

    // Always the same response — a differing one turns this into an account
    // enumeration oracle.
    res.json({ message: 'If that email is registered, a reset link has been sent' });
  }),
);

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

authRouter.post(
  '/reset-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = resetSchema.parse(req.body);
    const record = await prisma.passwordReset.findUnique({
      where: { tokenHash: hashToken(body.token) },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new ApiError(400, 'Invalid or expired reset token');
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await bcrypt.hash(body.password, 12) },
      }),
      prisma.passwordReset.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // Any session opened with the old password is now suspect.
    await revokeAllUserTokens(record.userId);

    res.json({ message: 'Password updated' });
  }),
);
