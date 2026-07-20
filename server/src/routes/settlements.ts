import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../errors';
import { requireAuth, currentUserId } from '../auth/middleware';
import { requireGroupMember, assertAllAreGroupMembers } from '../access';
import { isSupportedCurrency, toMinorUnits } from '../money/currency';
import { computeGroupBalances, computeUserBalances } from '../services/balanceService';

export const settlementsRouter = Router();
settlementsRouter.use(requireAuth);

const currencySchema = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase())
  .refine(isSupportedCurrency, 'Unsupported currency');

const createSettlementSchema = z.object({
  groupId: z.string().uuid().nullable().optional(),
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  amount: z.union([z.string(), z.number()]),
  currency: currencySchema,
  date: z.coerce.date().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  method: z.enum(['CASH', 'VENMO', 'BANK', 'OTHER']).default('CASH'),
});

settlementsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = createSettlementSchema.parse(req.body);

    if (body.fromUserId === body.toUserId) {
      throw new ApiError(400, 'A settlement needs two different people');
    }

    // Only the payer or the payee may record a payment between them.
    if (userId !== body.fromUserId && userId !== body.toUserId) {
      throw new ApiError(403, 'You can only record a payment you are part of');
    }

    if (body.groupId) {
      await requireGroupMember(body.groupId, userId);
      await assertAllAreGroupMembers(body.groupId, [body.fromUserId, body.toUserId]);
    }

    const amountMinor = toMinorUnits(
      typeof body.amount === 'number' ? body.amount : String(body.amount).trim(),
      body.currency,
    );

    if (amountMinor <= 0) {
      throw new ApiError(400, 'Settlement amount must be greater than zero');
    }

    const settlement = await prisma.settlement.create({
      data: {
        groupId: body.groupId ?? null,
        fromUserId: body.fromUserId,
        toUserId: body.toUserId,
        amountMinor,
        currency: body.currency,
        date: body.date ?? new Date(),
        note: body.note ?? null,
        method: body.method,
      },
    });

    await prisma.activityLog.create({
      data: {
        groupId: body.groupId ?? null,
        userId,
        actionType: 'SETTLEMENT_CREATED',
        targetId: settlement.id,
        metadata: {
          amountMinor,
          currency: body.currency,
          fromUserId: body.fromUserId,
          toUserId: body.toUserId,
        },
      },
    });

    res.status(201).json({ settlement });
  }),
);

settlementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const groupId = z.string().uuid().optional().parse(req.query.groupId);

    if (groupId) {
      await requireGroupMember(groupId, userId);
    }

    const settlements = await prisma.settlement.findMany({
      where: groupId
        ? { groupId, deletedAt: null }
        : { deletedAt: null, OR: [{ fromUserId: userId }, { toUserId: userId }] },
      include: {
        fromUser: { select: { id: true, name: true, avatarUrl: true } },
        toUser: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { date: 'desc' },
      take: 100,
    });

    res.json({ settlements });
  }),
);

settlementsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const settlement = await prisma.settlement.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });

    if (!settlement) throw new ApiError(404, 'Settlement not found');

    if (userId !== settlement.fromUserId && userId !== settlement.toUserId) {
      throw new ApiError(403, 'You can only undo a payment you are part of');
    }

    await prisma.settlement.update({
      where: { id: settlement.id },
      data: { deletedAt: new Date() },
    });

    await prisma.activityLog.create({
      data: {
        groupId: settlement.groupId,
        userId,
        actionType: 'SETTLEMENT_DELETED',
        targetId: settlement.id,
        metadata: { amountMinor: settlement.amountMinor, currency: settlement.currency },
      },
    });

    res.status(204).send();
  }),
);

// --- Balance views ------------------------------------------------------

export const balancesRouter = Router();
balancesRouter.use(requireAuth);

balancesRouter.get(
  '/groups/:groupId',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    await requireGroupMember(req.params.groupId, userId);

    const balances = await computeGroupBalances(req.params.groupId);
    const members = await prisma.groupMember.findMany({
      where: { groupId: req.params.groupId },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });

    res.json({
      ...balances,
      members: members.map((m) => ({ ...m.user, leftAt: m.leftAt })),
    });
  }),
);

balancesRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const { perFriend, totalsByCurrency } = await computeUserBalances(userId);

    const friendIds = Object.keys(perFriend);
    const friends = friendIds.length
      ? await prisma.user.findMany({
          where: { id: { in: friendIds } },
          select: { id: true, name: true, avatarUrl: true, email: true },
        })
      : [];

    res.json({
      totalsByCurrency,
      friends: friends.map((f) => ({ ...f, balances: perFriend[f.id] })),
    });
  }),
);
