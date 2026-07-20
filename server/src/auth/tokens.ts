import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config';
import { prisma } from '../db';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL,
    issuer: 'dutchie',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_ACCESS_SECRET, {
    issuer: 'dutchie',
  }) as AccessTokenPayload;
}

/**
 * Refresh tokens are opaque random strings, stored only as a SHA-256 hash.
 * A database leak then yields no usable sessions, and logout can genuinely
 * revoke — which a bare stateless JWT cannot do.
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const { token, hash } = generateRefreshToken();
  const expiresAt = new Date(
    Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  await prisma.refreshToken.create({ data: { userId, tokenHash: hash, expiresAt } });
  return token;
}

/**
 * Consume a refresh token and issue a fresh one (rotation). Returns null if the
 * token is unknown, expired, or already revoked.
 */
export async function rotateRefreshToken(
  token: string,
): Promise<{ userId: string; refreshToken: string } | null> {
  const hash = hashToken(token);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    return null;
  }

  // Rotate: the presented token dies as the replacement is minted, so a stolen
  // token is single-use at best.
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });

  const refreshToken = await issueRefreshToken(record.userId);
  return { userId: record.userId, refreshToken };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const hash = hashToken(token);
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
