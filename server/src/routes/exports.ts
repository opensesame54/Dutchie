import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../errors';
import { requireAuth, currentUserId } from '../auth/middleware';
import { requireGroupMember } from '../access';
import { fromMinorUnits } from '../money/currency';

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

/**
 * RFC 4180 CSV escaping. Naive join-with-commas breaks the moment someone
 * writes "Dinner, drinks" — and a broken ledger export is worse than none.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // A leading =, +, - or @ is executed as a formula by Excel and Sheets, so
  // neutralise it: an expense description should never run as code.
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

exportsRouter.get(
  '/groups/:groupId.csv',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const { groupId } = req.params;
    await requireGroupMember(groupId, userId);

    const [group, expenses, settlements] = await Promise.all([
      prisma.group.findUniqueOrThrow({
        where: { id: groupId },
        include: { members: { include: { user: { select: { id: true, name: true } } } } },
      }),
      prisma.expense.findMany({
        where: { groupId, deletedAt: null, isTemplate: false },
        include: { payers: true, splits: true },
        orderBy: { date: 'asc' },
      }),
      prisma.settlement.findMany({
        where: { groupId, deletedAt: null },
        include: {
          fromUser: { select: { name: true } },
          toUser: { select: { name: true } },
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    const names = new Map(group.members.map((m) => [m.user.id, m.user.name]));
    const memberIds = group.members.map((m) => m.user.id);

    const lines: string[] = [];

    // One column per member showing their share, so the export reconciles
    // column-wise the way a spreadsheet user expects.
    lines.push(
      csvRow([
        'Date', 'Type', 'Description', 'Category', 'Currency', 'Amount', 'Paid by',
        ...memberIds.map((id) => `${names.get(id) ?? id} share`),
      ]),
    );

    for (const e of expenses) {
      const paidBy = e.payers
        .map((p) => `${names.get(p.userId) ?? p.userId} (${fromMinorUnits(p.amountMinor, e.currency)})`)
        .join(' + ');

      const shares = memberIds.map((id) => {
        const split = e.splits.find((s) => s.userId === id);
        return split ? fromMinorUnits(split.owedAmountMinor, e.currency) : '';
      });

      lines.push(
        csvRow([
          e.date.toISOString().slice(0, 10),
          'expense',
          e.description,
          e.category,
          e.currency,
          fromMinorUnits(e.amountMinor, e.currency),
          paidBy,
          ...shares,
        ]),
      );
    }

    for (const s of settlements) {
      lines.push(
        csvRow([
          s.date.toISOString().slice(0, 10),
          'settlement',
          `${s.fromUser.name} paid ${s.toUser.name}`,
          s.method,
          s.currency,
          fromMinorUnits(s.amountMinor, s.currency),
          s.fromUser.name,
          ...memberIds.map(() => ''),
        ]),
      );
    }

    const filename = `${group.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-ledger.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // A BOM so Excel opens UTF-8 names (José, Zoë) correctly instead of mojibake.
    res.send(`﻿${lines.join('\r\n')}\r\n`);
  }),
);
