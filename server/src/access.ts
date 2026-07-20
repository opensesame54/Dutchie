import { prisma } from './db';
import { ApiError } from './errors';

/**
 * Authorization helpers. Every group-scoped route funnels through these — the
 * rule is that membership is checked in one place, not re-implemented per
 * handler where one missing check silently exposes another group's ledger.
 */

export interface Membership {
  groupId: string;
  userId: string;
  role: 'ADMIN' | 'MEMBER';
}

/** Assert the user is a current (not departed) member of the group. */
export async function requireGroupMember(
  groupId: string,
  userId: string,
): Promise<Membership> {
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });

  // 404 rather than 403 for non-members: confirming a group exists to someone
  // outside it leaks that it exists at all.
  if (!member || member.leftAt) {
    throw new ApiError(404, 'Group not found');
  }

  return { groupId, userId, role: member.role };
}

export async function requireGroupAdmin(
  groupId: string,
  userId: string,
): Promise<Membership> {
  const member = await requireGroupMember(groupId, userId);
  if (member.role !== 'ADMIN') {
    throw new ApiError(403, 'This action requires group admin privileges');
  }
  return member;
}

/**
 * Assert the user may see/modify an expense. Group expenses require group
 * membership; direct (groupless) expenses require being a payer or a
 * participant in the split.
 */
export async function requireExpenseAccess(expenseId: string, userId: string) {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, deletedAt: null },
    include: { payers: true, splits: true },
  });

  if (!expense) {
    throw new ApiError(404, 'Expense not found');
  }

  if (expense.groupId) {
    await requireGroupMember(expense.groupId, userId);
    return expense;
  }

  const involved =
    expense.createdById === userId ||
    expense.payers.some((p) => p.userId === userId) ||
    expense.splits.some((s) => s.userId === userId);

  if (!involved) {
    throw new ApiError(404, 'Expense not found');
  }

  return expense;
}

/** Every user id must belong to a current member of the group. */
export async function assertAllAreGroupMembers(
  groupId: string,
  userIds: string[],
): Promise<void> {
  const unique = [...new Set(userIds)];
  const members = await prisma.groupMember.findMany({
    where: { groupId, userId: { in: unique }, leftAt: null },
    select: { userId: true },
  });

  const found = new Set(members.map((m) => m.userId));
  const missing = unique.filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw new ApiError(
      400,
      `These users are not members of this group: ${missing.join(', ')}`,
    );
  }
}
