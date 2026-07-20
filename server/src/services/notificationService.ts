import { prisma } from '../db';
import { fromMinorUnits } from '../money/currency';

/**
 * Notifications: a durable in-app record plus best-effort Expo push.
 *
 * The DB row is written first and is what the notification bell reads. Push
 * delivery is explicitly best-effort — a device with a stale token or no
 * network must never cause the expense that triggered it to fail, so every
 * push path swallows its errors after pruning dead tokens.
 */

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  targetId?: string | null;
  groupId?: string | null;
}

export async function createNotifications(inputs: NotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;

  await prisma.notification.createMany({
    data: inputs.map((n) => ({
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      targetId: n.targetId ?? null,
      groupId: n.groupId ?? null,
    })),
  });

  await sendPush(inputs).catch((err) => {
    console.warn('Push delivery failed (notifications were still recorded):', err);
  });
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  channelId: string;
}

async function sendPush(inputs: NotificationInput[]): Promise<void> {
  const userIds = [...new Set(inputs.map((n) => n.userId))];
  const tokens = await prisma.deviceToken.findMany({
    where: { userId: { in: userIds } },
  });
  if (tokens.length === 0) return;

  const byUser = new Map<string, string[]>();
  for (const t of tokens) {
    byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), t.token]);
  }

  const messages: ExpoMessage[] = [];
  for (const n of inputs) {
    for (const to of byUser.get(n.userId) ?? []) {
      messages.push({
        to,
        title: n.title,
        body: n.body,
        data: { type: n.type, targetId: n.targetId, groupId: n.groupId },
        sound: 'default',
        // Must match the channel the app creates, or Android silently drops it.
        channelId: 'default',
      });
    }
  }

  if (messages.length === 0) return;

  // Expo caps a request at 100 messages.
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      console.warn(`Expo push returned ${res.status}`);
      continue;
    }

    const payload = (await res.json()) as {
      data?: { status: string; details?: { error?: string } }[];
    };

    // Prune tokens Expo tells us are dead, otherwise they accumulate forever
    // and every send wastes a slot on a device that uninstalled months ago.
    const dead: string[] = [];
    payload.data?.forEach((ticket, idx) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        dead.push(batch[idx].to);
      }
    });

    if (dead.length > 0) {
      await prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
    }
  }
}

/** Everyone affected by an expense except the person who created it. */
export async function notifyExpenseCreated(expenseId: string): Promise<void> {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      splits: true,
      payers: true,
      createdBy: { select: { name: true } },
      group: { select: { name: true } },
    },
  });
  if (!expense) return;

  const affected = new Set([
    ...expense.splits.map((s) => s.userId),
    ...expense.payers.map((p) => p.userId),
  ]);
  affected.delete(expense.createdById);
  if (affected.size === 0) return;

  const recipients = await prisma.user.findMany({
    where: { id: { in: [...affected] }, notifyOnExpense: true },
    select: { id: true },
  });

  const amount = `${fromMinorUnits(expense.amountMinor, expense.currency)} ${expense.currency}`;
  const where = expense.group ? ` in ${expense.group.name}` : '';

  await createNotifications(
    recipients.map((r) => ({
      userId: r.id,
      type: 'EXPENSE_CREATED',
      title: `${expense.createdBy.name} added an expense`,
      body: `${expense.description} — ${amount}${where}`,
      targetId: expense.id,
      groupId: expense.groupId,
    })),
  );
}

export async function notifySettlement(settlementId: string): Promise<void> {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    include: {
      fromUser: { select: { id: true, name: true } },
      toUser: { select: { id: true, name: true, notifyOnSettlement: true } },
      group: { select: { name: true } },
    },
  });
  if (!settlement || !settlement.toUser.notifyOnSettlement) return;

  const amount = `${fromMinorUnits(settlement.amountMinor, settlement.currency)} ${settlement.currency}`;

  await createNotifications([
    {
      userId: settlement.toUser.id,
      type: 'SETTLEMENT_CREATED',
      title: 'Payment received',
      body: `${settlement.fromUser.name} paid you ${amount}`,
      targetId: settlement.id,
      groupId: settlement.groupId,
    },
  ]);
}

export async function notifyAddedToGroup(groupId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { name: true },
  });
  if (!group) return;

  await createNotifications(
    userIds.map((userId) => ({
      userId,
      type: 'ADDED_TO_GROUP',
      title: 'Added to a group',
      body: `You were added to ${group.name}`,
      targetId: groupId,
      groupId,
    })),
  );
}
