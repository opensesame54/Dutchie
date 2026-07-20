import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../errors';
import { requireAuth, currentUserId } from '../auth/middleware';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const listSchema = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const q = listSchema.parse(req.query);

    const notifications = await prisma.notification.findMany({
      where: { userId, ...(q.unreadOnly ? { readAt: null } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    const hasMore = notifications.length > q.limit;
    const page = hasMore ? notifications.slice(0, q.limit) : notifications;
    const unreadCount = await prisma.notification.count({ where: { userId, readAt: null } });

    res.json({
      notifications: page,
      unreadCount,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    });
  }),
);

notificationsRouter.post(
  '/read',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = z
      .object({ ids: z.array(z.string().uuid()).max(200).optional() })
      .parse(req.body ?? {});

    // Scoping the update by userId means a caller cannot mark someone else's
    // notifications read by guessing ids.
    const result = await prisma.notification.updateMany({
      where: { userId, readAt: null, ...(body.ids ? { id: { in: body.ids } } : {}) },
      data: { readAt: new Date() },
    });

    res.json({ marked: result.count });
  }),
);

// --- Device tokens ------------------------------------------------------

const registerSchema = z.object({
  token: z.string().trim().min(1).max(255),
  platform: z.enum(['android', 'ios']).default('android'),
});

notificationsRouter.post(
  '/devices',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = registerSchema.parse(req.body);

    // A token is unique to an installation, but the account signed in on that
    // device can change — so re-registering reassigns ownership rather than
    // failing, otherwise the previous user keeps getting the new user's pushes.
    const device = await prisma.deviceToken.upsert({
      where: { token: body.token },
      create: { userId, token: body.token, platform: body.platform },
      update: { userId, platform: body.platform, lastSeenAt: new Date() },
    });

    res.status(201).json({ device: { id: device.id, platform: device.platform } });
  }),
);

notificationsRouter.delete(
  '/devices/:token',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const result = await prisma.deviceToken.deleteMany({
      where: { token: req.params.token, userId },
    });
    if (result.count === 0) throw new ApiError(404, 'Device token not found');
    res.status(204).send();
  }),
);

// --- Preferences --------------------------------------------------------

const prefsSchema = z.object({
  notifyOnExpense: z.boolean().optional(),
  notifyOnSettlement: z.boolean().optional(),
  weeklyDigest: z.boolean().optional(),
});

notificationsRouter.patch(
  '/preferences',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = prefsSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: body,
      select: { notifyOnExpense: true, notifyOnSettlement: true, weeklyDigest: true },
    });

    res.json({ preferences: user });
  }),
);
