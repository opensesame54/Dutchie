import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../errors';
import { requireAuth, currentUserId } from '../auth/middleware';
import { requireGroupMember, requireExpenseAccess, assertAllAreGroupMembers } from '../access';
import { computeSplits, validatePayers, type SplitType } from '../core/splits';
import { isSupportedCurrency, toMinorUnits } from '../money/currency';
import { materialiseTemplate } from '../services/recurringService';
import { notifyExpenseCreated } from '../services/notificationService';

export const expensesRouter = Router();
expensesRouter.use(requireAuth);

const currencySchema = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase())
  .refine(isSupportedCurrency, 'Unsupported currency');

// Amounts arrive as decimal strings ("12.34") rather than floats — JSON numbers
// cannot represent every cent exactly and a rounding drift here is a real
// accounting error.
const amountSchema = z.union([z.string(), z.number()]);

const expenseBodySchema = z
  .object({
    groupId: z.string().uuid().nullable().optional(),
    description: z.string().trim().min(1).max(200),
    amount: amountSchema,
    currency: currencySchema,
    category: z.string().trim().max(50).default('general'),
    date: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    receiptUrl: z.string().url().nullable().optional(),
    splitType: z.enum(['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES']).default('EQUAL'),
    payers: z
      .array(z.object({ userId: z.string().uuid(), amount: amountSchema }))
      .min(1)
      .max(50),
    participants: z
      .array(z.object({ userId: z.string().uuid(), value: z.number().int().optional() }))
      .min(1)
      .max(50),
    isRecurring: z.boolean().default(false),
    recurrenceRule: z.string().max(200).nullable().optional(),
  })
  .refine((b) => !b.isRecurring || !!b.recurrenceRule, {
    message: 'A recurring expense needs a recurrence rule',
    path: ['recurrenceRule'],
  });

type ExpenseBody = z.infer<typeof expenseBodySchema>;

/**
 * Convert the request into validated minor-unit payers and splits. Shared by
 * create and update so both enforce identical invariants.
 */
function buildExpenseParts(body: ExpenseBody) {
  const totalMinor = toMinorUnits(
    typeof body.amount === 'number' ? body.amount : String(body.amount).trim(),
    body.currency,
  );

  if (totalMinor <= 0) {
    throw new ApiError(400, 'Expense amount must be greater than zero');
  }

  const payers = body.payers.map((p) => ({
    userId: p.userId,
    amountMinor: toMinorUnits(
      typeof p.amount === 'number' ? p.amount : String(p.amount).trim(),
      body.currency,
    ),
  }));

  validatePayers(totalMinor, payers);
  const splits = computeSplits(totalMinor, body.splitType as SplitType, body.participants);

  return { totalMinor, payers, splits };
}

expensesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = expenseBodySchema.parse(req.body);

    const involved = [
      ...body.payers.map((p) => p.userId),
      ...body.participants.map((p) => p.userId),
    ];

    if (body.groupId) {
      await requireGroupMember(body.groupId, userId);
      await assertAllAreGroupMembers(body.groupId, involved);
    } else {
      // A direct expense must involve its creator, otherwise anyone could
      // fabricate debts between two unrelated accounts.
      if (!involved.includes(userId)) {
        throw new ApiError(403, 'You must be part of a direct expense you create');
      }
      const others = [...new Set(involved)].filter((id) => id !== userId);
      const existing = await prisma.user.count({ where: { id: { in: others } } });
      if (existing !== others.length) {
        throw new ApiError(400, 'One or more users do not exist');
      }
    }

    const { totalMinor, payers, splits } = buildExpenseParts(body);

    const expense = await prisma.expense.create({
      data: {
        groupId: body.groupId ?? null,
        description: body.description,
        amountMinor: totalMinor,
        currency: body.currency,
        category: body.category,
        date: body.date ?? new Date(),
        notes: body.notes ?? null,
        receiptUrl: body.receiptUrl ?? null,
        splitType: body.splitType,
        createdById: userId,
        isRecurring: body.isRecurring,
        recurrenceRule: body.recurrenceRule ?? null,
        // A recurring expense is stored as a template that spawns instances;
        // the template itself is excluded from balances.
        isTemplate: body.isRecurring,
        nextOccurrenceAt: null,
        payers: { create: payers },
        splits: {
          create: splits.map((s) => ({
            userId: s.userId,
            owedAmountMinor: s.owedAmountMinor,
            shareValue: s.shareValue,
          })),
        },
      },
      include: { payers: true, splits: true },
    });

    // A template produces its first instance immediately, so the user sees the
    // expense they just entered rather than waiting for the nightly job.
    if (body.isRecurring) {
      const materialised = await materialiseTemplate(expense.id);
      res.status(201).json({ template: expense, expense: materialised });
      return;
    }

    await prisma.activityLog.create({
      data: {
        groupId: body.groupId ?? null,
        userId,
        actionType: 'EXPENSE_CREATED',
        targetId: expense.id,
        metadata: {
          description: expense.description,
          amountMinor: expense.amountMinor,
          currency: expense.currency,
        },
      },
    });

    // Best-effort: a failed push must not fail the expense.
    await notifyExpenseCreated(expense.id).catch(() => undefined);

    res.status(201).json({ expense });
  }),
);

/** Recurring templates for a group (the schedules, not the generated expenses). */
expensesRouter.get(
  '/recurring/templates',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const groupId = z.string().uuid().optional().parse(req.query.groupId);
    if (groupId) await requireGroupMember(groupId, userId);

    const templates = await prisma.expense.findMany({
      where: {
        isTemplate: true,
        deletedAt: null,
        ...(groupId
          ? { groupId }
          : { group: { members: { some: { userId, leftAt: null } } } }),
      },
      include: { payers: true, splits: true, _count: { select: { recurringInstances: true } } },
      orderBy: { nextOccurrenceAt: 'asc' },
    });

    res.json({ templates });
  }),
);

const listQuerySchema = z.object({
  groupId: z.string().uuid().optional(),
  friendId: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(50).optional(),
  paidBy: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

expensesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const q = listQuerySchema.parse(req.query);

    if (q.groupId) {
      await requireGroupMember(q.groupId, userId);
    }

    // Templates are schedules; they are listed separately, not in the feed.
    const where: Record<string, unknown> = { deletedAt: null, isTemplate: false };

    if (q.groupId) {
      where.groupId = q.groupId;
    } else if (q.friendId) {
      // Direct expenses shared with one friend.
      where.groupId = null;
      where.AND = [
        { OR: [{ splits: { some: { userId } } }, { payers: { some: { userId } } }] },
        { OR: [{ splits: { some: { userId: q.friendId } } }, { payers: { some: { userId: q.friendId } } }] },
      ];
    } else {
      // Everything the caller can see.
      where.OR = [
        { group: { members: { some: { userId, leftAt: null } } } },
        { AND: [{ groupId: null }, { splits: { some: { userId } } }] },
        { AND: [{ groupId: null }, { payers: { some: { userId } } }] },
      ];
    }

    if (q.search) where.description = { contains: q.search, mode: 'insensitive' };
    if (q.category) where.category = q.category;
    if (q.paidBy) where.payers = { some: { userId: q.paidBy } };
    if (q.from || q.to) {
      where.date = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    }

    const expenses = await prisma.expense.findMany({
      where,
      include: { payers: true, splits: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    const hasMore = expenses.length > q.limit;
    const page = hasMore ? expenses.slice(0, q.limit) : expenses;

    res.json({
      expenses: page,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    });
  }),
);

expensesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const expense = await requireExpenseAccess(req.params.id, currentUserId(req));
    res.json({ expense });
  }),
);

expensesRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const existing = await requireExpenseAccess(req.params.id, userId);
    const body = expenseBodySchema.parse(req.body);

    // Moving an expense between groups would silently rewrite two ledgers.
    if ((body.groupId ?? null) !== existing.groupId) {
      throw new ApiError(400, 'An expense cannot be moved to a different group');
    }

    if (existing.groupId) {
      await assertAllAreGroupMembers(existing.groupId, [
        ...body.payers.map((p) => p.userId),
        ...body.participants.map((p) => p.userId),
      ]);
    }

    const { totalMinor, payers, splits } = buildExpenseParts(body);

    // Replace payers/splits wholesale inside one transaction so the expense is
    // never briefly readable in an unbalanced state.
    const expense = await prisma.$transaction(async (tx) => {
      await tx.expensePayer.deleteMany({ where: { expenseId: existing.id } });
      await tx.expenseSplit.deleteMany({ where: { expenseId: existing.id } });

      return tx.expense.update({
        where: { id: existing.id },
        data: {
          description: body.description,
          amountMinor: totalMinor,
          currency: body.currency,
          category: body.category,
          date: body.date ?? existing.date,
          notes: body.notes ?? null,
          receiptUrl: body.receiptUrl ?? null,
          splitType: body.splitType,
          isRecurring: body.isRecurring,
          recurrenceRule: body.recurrenceRule ?? null,
          payers: { create: payers },
          splits: {
            create: splits.map((s) => ({
              userId: s.userId,
              owedAmountMinor: s.owedAmountMinor,
              shareValue: s.shareValue,
            })),
          },
        },
        include: { payers: true, splits: true },
      });
    });

    await prisma.activityLog.create({
      data: {
        groupId: existing.groupId,
        userId,
        actionType: 'EXPENSE_UPDATED',
        targetId: expense.id,
        metadata: {
          description: expense.description,
          amountMinor: expense.amountMinor,
          previousAmountMinor: existing.amountMinor,
          currency: expense.currency,
        },
      },
    });

    res.json({ expense });
  }),
);

expensesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const existing = await requireExpenseAccess(req.params.id, userId);

    // Soft delete: the activity feed still needs to show what was removed.
    await prisma.expense.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    await prisma.activityLog.create({
      data: {
        groupId: existing.groupId,
        userId,
        actionType: 'EXPENSE_DELETED',
        targetId: existing.id,
        metadata: {
          description: existing.description,
          amountMinor: existing.amountMinor,
          currency: existing.currency,
        },
      },
    });

    res.status(204).send();
  }),
);

// --- Comments -----------------------------------------------------------

const commentSchema = z.object({ text: z.string().trim().min(1).max(1000) });

expensesRouter.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    await requireExpenseAccess(req.params.id, currentUserId(req));
    const comments = await prisma.comment.findMany({
      where: { expenseId: req.params.id },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ comments });
  }),
);

expensesRouter.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const expense = await requireExpenseAccess(req.params.id, userId);
    const body = commentSchema.parse(req.body);

    const comment = await prisma.comment.create({
      data: { expenseId: expense.id, userId, text: body.text },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });

    await prisma.activityLog.create({
      data: {
        groupId: expense.groupId,
        userId,
        actionType: 'COMMENT_ADDED',
        targetId: expense.id,
        metadata: { description: expense.description },
      },
    });

    res.status(201).json({ comment });
  }),
);
