import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../errors';
import { requireAuth, currentUserId } from '../auth/middleware';
import { computeUserBalances } from '../services/balanceService';

export const friendsRouter = Router();
friendsRouter.use(requireAuth);

const requestSchema = z.object({ email: z.string().trim().toLowerCase().email() });

friendsRouter.post(
  '/requests',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = requestSchema.parse(req.body);

    const target = await prisma.user.findUnique({ where: { email: body.email } });
    if (!target) throw new ApiError(404, 'No Dutchie account uses that email');
    if (target.id === userId) throw new ApiError(400, 'You cannot add yourself');

    // A friendship is one relationship however it was initiated, so check both
    // directions before creating a duplicate.
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: target.id },
          { requesterId: target.id, addresseeId: userId },
        ],
      },
    });

    if (existing?.status === 'ACCEPTED') {
      throw new ApiError(409, 'You are already friends');
    }

    // If they already invited you, accept rather than opening a second request.
    if (existing?.status === 'PENDING' && existing.requesterId === target.id) {
      const accepted = await prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'ACCEPTED' },
      });
      return res.status(200).json({ friendship: accepted, autoAccepted: true });
    }

    if (existing) {
      const revived = await prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'PENDING', requesterId: userId, addresseeId: target.id },
      });
      return res.status(201).json({ friendship: revived, autoAccepted: false });
    }

    const friendship = await prisma.friendship.create({
      data: { requesterId: userId, addresseeId: target.id },
    });

    return res.status(201).json({ friendship, autoAccepted: false });
  }),
);

friendsRouter.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const [incoming, outgoing] = await Promise.all([
      prisma.friendship.findMany({
        where: { addresseeId: userId, status: 'PENDING' },
        include: { requester: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      }),
      prisma.friendship.findMany({
        where: { requesterId: userId, status: 'PENDING' },
        include: { addressee: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      }),
    ]);
    res.json({ incoming, outgoing });
  }),
);

const respondSchema = z.object({ accept: z.boolean() });

friendsRouter.post(
  '/requests/:id/respond',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = respondSchema.parse(req.body);

    const friendship = await prisma.friendship.findUnique({ where: { id: req.params.id } });

    // Only the person who received the request can answer it.
    if (!friendship || friendship.addresseeId !== userId) {
      throw new ApiError(404, 'Friend request not found');
    }
    if (friendship.status !== 'PENDING') {
      throw new ApiError(409, 'That request has already been answered');
    }

    const updated = await prisma.friendship.update({
      where: { id: friendship.id },
      data: { status: body.accept ? 'ACCEPTED' : 'DECLINED' },
    });

    res.json({ friendship: updated });
  }),
);

friendsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);

    const friendships = await prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: { id: true, name: true, email: true, avatarUrl: true } },
        addressee: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    const { perFriend } = await computeUserBalances(userId);

    const friends = friendships.map((f) => {
      const friend = f.requesterId === userId ? f.addressee : f.requester;
      return { ...friend, balances: perFriend[friend.id] ?? {} };
    });

    // People you share expenses with but have not formally friended still need
    // to appear, otherwise their balance is invisible.
    const known = new Set(friends.map((f) => f.id));
    const unlinkedIds = Object.keys(perFriend).filter((id) => !known.has(id));
    const unlinked = unlinkedIds.length
      ? await prisma.user.findMany({
          where: { id: { in: unlinkedIds } },
          select: { id: true, name: true, email: true, avatarUrl: true },
        })
      : [];

    res.json({
      friends: [
        ...friends,
        ...unlinked.map((u) => ({ ...u, balances: perFriend[u.id], viaSharedExpenses: true })),
      ],
    });
  }),
);

friendsRouter.delete(
  '/:friendId',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const { perFriend } = await computeUserBalances(userId);

    const outstanding = Object.entries(perFriend[req.params.friendId] ?? {}).filter(
      ([, amount]) => amount !== 0,
    );

    if (outstanding.length > 0) {
      throw new ApiError(409, 'Settle up before removing this friend', {
        outstanding: Object.fromEntries(outstanding),
      });
    }

    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: userId, addresseeId: req.params.friendId },
          { requesterId: req.params.friendId, addresseeId: userId },
        ],
      },
    });

    res.status(204).send();
  }),
);
