import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../errors';
import { requireAuth, currentUserId } from '../auth/middleware';
import { requireGroupMember } from '../access';

export const activityRouter = Router();
activityRouter.use(requireAuth);

const querySchema = z.object({
  groupId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

activityRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const q = querySchema.parse(req.query);

    if (q.groupId) {
      await requireGroupMember(q.groupId, userId);
    }

    const entries = await prisma.activityLog.findMany({
      where: q.groupId
        ? { groupId: q.groupId }
        : {
            // The global feed spans every group the user is currently in, plus
            // their own actions on direct expenses.
            OR: [
              { group: { members: { some: { userId, leftAt: null } } } },
              { AND: [{ groupId: null }, { userId }] },
            ],
          },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    const hasMore = entries.length > q.limit;
    const page = hasMore ? entries.slice(0, q.limit) : entries;

    res.json({
      activity: page,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    });
  }),
);
