import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../errors';
import { requireAuth, currentUserId } from '../auth/middleware';
import { requireGroupMember, requireGroupAdmin } from '../access';
import { isSupportedCurrency } from '../money/currency';
import { computeGroupBalances } from '../services/balanceService';
import { notifyAddedToGroup } from '../services/notificationService';

export const groupsRouter = Router();
groupsRouter.use(requireAuth);

const currencySchema = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase())
  .refine(isSupportedCurrency, 'Unsupported currency');

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(['TRIP', 'HOME', 'COUPLE', 'OTHER']).default('OTHER'),
  defaultCurrency: currencySchema.optional(),
  avatarUrl: z.string().url().nullable().optional(),
  /** Emails to invite. Unknown emails are reported back, not silently dropped. */
  memberEmails: z.array(z.string().trim().toLowerCase().email()).max(50).optional(),
});

groupsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = createGroupSchema.parse(req.body);

    const creator = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const invitees = body.memberEmails?.length
      ? await prisma.user.findMany({ where: { email: { in: body.memberEmails } } })
      : [];
    const foundEmails = new Set(invitees.map((u) => u.email));
    const notFound = (body.memberEmails ?? []).filter(
      (e) => !foundEmails.has(e) && e !== creator.email,
    );

    const group = await prisma.group.create({
      data: {
        name: body.name,
        type: body.type,
        avatarUrl: body.avatarUrl ?? null,
        defaultCurrency: body.defaultCurrency ?? creator.defaultCurrency,
        createdById: userId,
        members: {
          create: [
            { userId, role: 'ADMIN' },
            ...invitees
              .filter((u) => u.id !== userId)
              .map((u) => ({ userId: u.id, role: 'MEMBER' as const })),
          ],
        },
        activity: {
          create: { userId, actionType: 'GROUP_CREATED', metadata: { name: body.name } },
        },
      },
      include: { members: { include: { user: true } } },
    });

    res.status(201).json({ group: serializeGroup(group), invitesNotFound: notFound });
  }),
);

groupsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const groups = await prisma.group.findMany({
      where: { members: { some: { userId, leftAt: null } } },
      include: { members: { include: { user: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ groups: groups.map(serializeGroup) });
  }),
);

groupsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    await requireGroupMember(req.params.id, userId);

    const group = await prisma.group.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { members: { include: { user: true } } },
    });

    res.json({ group: serializeGroup(group) });
  }),
);

const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  defaultCurrency: currencySchema.optional(),
  type: z.enum(['TRIP', 'HOME', 'COUPLE', 'OTHER']).optional(),
});

groupsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    await requireGroupAdmin(req.params.id, userId);
    const body = updateGroupSchema.parse(req.body);

    const group = await prisma.group.update({
      where: { id: req.params.id },
      data: body,
      include: { members: { include: { user: true } } },
    });

    await prisma.activityLog.create({
      data: {
        groupId: group.id,
        userId,
        actionType: 'GROUP_UPDATED',
        metadata: body as object,
      },
    });

    res.json({ group: serializeGroup(group) });
  }),
);

// --- Membership ---------------------------------------------------------

const addMemberSchema = z.object({ email: z.string().trim().toLowerCase().email() });

groupsRouter.post(
  '/:id/members',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    await requireGroupMember(req.params.id, userId);
    const body = addMemberSchema.parse(req.body);

    const invitee = await prisma.user.findUnique({ where: { email: body.email } });
    if (!invitee) {
      throw new ApiError(404, 'No Dutchie account uses that email');
    }

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: req.params.id, userId: invitee.id } },
    });

    if (existing && !existing.leftAt) {
      throw new ApiError(409, 'That person is already in this group');
    }

    // Someone rejoining reuses their original row so their history stays attached.
    if (existing) {
      await prisma.groupMember.update({
        where: { id: existing.id },
        data: { leftAt: null, joinedAt: new Date() },
      });
    } else {
      await prisma.groupMember.create({
        data: { groupId: req.params.id, userId: invitee.id },
      });
    }

    await prisma.activityLog.create({
      data: {
        groupId: req.params.id,
        userId: invitee.id,
        actionType: 'MEMBER_JOINED',
        metadata: { name: invitee.name, addedBy: userId },
      },
    });

    await notifyAddedToGroup(req.params.id, [invitee.id]).catch(() => undefined);

    res.status(201).json({ member: { id: invitee.id, name: invitee.name, email: invitee.email } });
  }),
);

groupsRouter.post(
  '/join/:inviteCode',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const group = await prisma.group.findUnique({
      where: { inviteCode: req.params.inviteCode },
    });

    if (!group) throw new ApiError(404, 'That invite link is not valid');

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId } },
    });

    if (existing && !existing.leftAt) {
      return res.json({ group: { id: group.id, name: group.name }, alreadyMember: true });
    }

    if (existing) {
      await prisma.groupMember.update({
        where: { id: existing.id },
        data: { leftAt: null, joinedAt: new Date() },
      });
    } else {
      await prisma.groupMember.create({ data: { groupId: group.id, userId } });
    }

    await prisma.activityLog.create({
      data: { groupId: group.id, userId, actionType: 'MEMBER_JOINED', metadata: {} },
    });

    return res.status(201).json({ group: { id: group.id, name: group.name }, alreadyMember: false });
  }),
);

/**
 * Removing a member (or leaving). Blocked while they still owe or are owed —
 * dropping them would silently rewrite everyone else's balances.
 */
groupsRouter.delete(
  '/:id/members/:userId',
  asyncHandler(async (req, res) => {
    const actorId = currentUserId(req);
    const { id: groupId, userId: targetId } = req.params;

    const actor = await requireGroupMember(groupId, actorId);
    if (targetId !== actorId && actor.role !== 'ADMIN') {
      throw new ApiError(403, 'Only an admin can remove someone else');
    }

    const target = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetId } },
    });
    if (!target || target.leftAt) {
      throw new ApiError(404, 'That person is not in this group');
    }

    const { balancesByCurrency } = await computeGroupBalances(groupId);
    const outstanding = Object.entries(balancesByCurrency)
      .map(([currency, net]) => ({ currency, amount: net[targetId] ?? 0 }))
      .filter((b) => b.amount !== 0);

    if (outstanding.length > 0) {
      throw new ApiError(409, 'That balance must be settled first', { outstanding });
    }

    const remaining = await prisma.groupMember.count({
      where: { groupId, leftAt: null, userId: { not: targetId } },
    });
    const remainingAdmins = await prisma.groupMember.count({
      where: { groupId, leftAt: null, role: 'ADMIN', userId: { not: targetId } },
    });

    await prisma.$transaction(async (tx) => {
      await tx.groupMember.update({
        where: { id: target.id },
        data: { leftAt: new Date() },
      });

      // Never strand a group with members but no admin.
      if (remaining > 0 && remainingAdmins === 0) {
        const successor = await tx.groupMember.findFirst({
          where: { groupId, leftAt: null, userId: { not: targetId } },
          orderBy: { joinedAt: 'asc' },
        });
        if (successor) {
          await tx.groupMember.update({ where: { id: successor.id }, data: { role: 'ADMIN' } });
        }
      }

      await tx.activityLog.create({
        data: {
          groupId,
          userId: targetId,
          actionType: targetId === actorId ? 'MEMBER_LEFT' : 'MEMBER_REMOVED',
          metadata: { removedBy: actorId },
        },
      });
    });

    res.status(204).send();
  }),
);

function serializeGroup(group: {
  id: string; name: string; type: string; avatarUrl: string | null;
  defaultCurrency: string; inviteCode: string; createdAt: Date;
  members?: { userId: string; role: string; leftAt: Date | null; user: { id: string; name: string; email: string; avatarUrl: string | null } }[];
}) {
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    avatarUrl: group.avatarUrl,
    defaultCurrency: group.defaultCurrency,
    inviteCode: group.inviteCode,
    createdAt: group.createdAt,
    members: group.members
      ?.filter((m) => !m.leftAt)
      .map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        role: m.role,
      })),
  };
}
