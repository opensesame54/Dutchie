import { prisma } from '../db';
import {
  parseRecurrenceRule, occurrencesBetween, nextOccurrence, startOfUtcDay,
  RecurrenceError,
} from '../core/recurrence';
import { notifyExpenseCreated } from './notificationService';

/**
 * Materialises recurring expense templates into real, dated expenses.
 *
 * Two properties matter more than anything else here:
 *
 *  1. IDEMPOTENCE. The job may run twice, overlap with itself, or be retried
 *     after a crash. A unique constraint on (recurringTemplateId, date) makes
 *     a duplicate physically impossible, and we swallow exactly that conflict.
 *  2. CATCH-UP. If the server was down for a month, every occurrence that fell
 *     due in the gap is generated — once each — rather than only the latest.
 *
 * Getting either wrong invents or loses money, so both are covered by tests.
 */

/** Postgres unique-violation code, surfaced by Prisma as P2002. */
const UNIQUE_VIOLATION = 'P2002';

export interface GenerationResult {
  templatesScanned: number;
  expensesCreated: number;
  templatesCompleted: number;
  errors: { templateId: string; message: string }[];
}

export async function generateDueExpenses(now = new Date()): Promise<GenerationResult> {
  const result: GenerationResult = {
    templatesScanned: 0,
    expensesCreated: 0,
    templatesCompleted: 0,
    errors: [],
  };

  const templates = await prisma.expense.findMany({
    where: {
      isTemplate: true,
      deletedAt: null,
      nextOccurrenceAt: { lte: now },
    },
    include: { payers: true, splits: true },
  });

  result.templatesScanned = templates.length;

  for (const template of templates) {
    try {
      const created = await generateForTemplate(template, now);
      result.expensesCreated += created.created;
      if (created.completed) result.templatesCompleted += 1;
    } catch (err) {
      // One malformed template must not stop the rest of the run.
      result.errors.push({
        templateId: template.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

type TemplateWithParts = Awaited<ReturnType<typeof prisma.expense.findMany>>[number] & {
  payers: { userId: string; amountMinor: number }[];
  splits: { userId: string; owedAmountMinor: number; shareValue: number | null }[];
};

async function generateForTemplate(
  template: TemplateWithParts,
  now: Date,
): Promise<{ created: number; completed: boolean }> {
  if (!template.recurrenceRule) {
    throw new RecurrenceError('Template has no recurrence rule');
  }

  const rule = parseRecurrenceRule(template.recurrenceRule);

  // How many instances already exist decides where COUNT stands.
  const alreadyGenerated = await prisma.expense.count({
    where: { recurringTemplateId: template.id },
  });

  // Walk from the last generated occurrence, not from the template's original
  // date, so a long-running series does not rescan its whole history.
  const lastInstance = await prisma.expense.findFirst({
    where: { recurringTemplateId: template.id },
    orderBy: { date: 'desc' },
    select: { date: true },
  });

  const cursor = lastInstance?.date ?? template.date;
  const due = occurrencesBetween(rule, template.date, cursor, now, alreadyGenerated);

  let created = 0;
  for (const date of due) {
    const didCreate = await createInstance(template, date);
    if (didCreate) created += 1;
  }

  // Work out when this template is next due, or retire it.
  const totalNow = alreadyGenerated + created;
  const upcoming = nextOccurrence(
    rule,
    template.date,
    due.length > 0 ? due[due.length - 1] : cursor,
    totalNow,
  );

  await prisma.expense.update({
    where: { id: template.id },
    data: { nextOccurrenceAt: upcoming },
  });

  return { created, completed: upcoming === null };
}

async function createInstance(template: TemplateWithParts, date: Date): Promise<boolean> {
  const normalisedDate = startOfUtcDay(date);

  try {
    const expense = await prisma.expense.create({
      data: {
        groupId: template.groupId,
        description: template.description,
        amountMinor: template.amountMinor,
        currency: template.currency,
        category: template.category,
        date: normalisedDate,
        notes: template.notes,
        splitType: template.splitType,
        createdById: template.createdById,
        // The instance is a real expense, not another template.
        isRecurring: false,
        isTemplate: false,
        recurringTemplateId: template.id,
        payers: {
          create: template.payers.map((p) => ({
            userId: p.userId,
            amountMinor: p.amountMinor,
          })),
        },
        splits: {
          create: template.splits.map((s) => ({
            userId: s.userId,
            owedAmountMinor: s.owedAmountMinor,
            shareValue: s.shareValue,
          })),
        },
      },
      include: { payers: true, splits: true },
    });

    await prisma.activityLog.create({
      data: {
        groupId: template.groupId,
        userId: template.createdById,
        actionType: 'EXPENSE_CREATED',
        targetId: expense.id,
        createdAt: normalisedDate,
        metadata: {
          description: expense.description,
          amountMinor: expense.amountMinor,
          currency: expense.currency,
          recurring: true,
        },
      },
    });

    await notifyExpenseCreated(expense.id).catch(() => undefined);

    return true;
  } catch (err) {
    // The unique index did its job: this occurrence already exists, so a
    // concurrent or repeated run is a no-op rather than a duplicate charge.
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === UNIQUE_VIOLATION
  );
}

/**
 * Create the first instance of a freshly-made template and set its next due
 * date, so a user who adds "rent, monthly" sees this month's rent immediately
 * rather than waiting for the nightly job.
 */
export async function materialiseTemplate(templateId: string) {
  const template = await prisma.expense.findUnique({
    where: { id: templateId },
    include: { payers: true, splits: true },
  });
  if (!template || !template.isTemplate || !template.recurrenceRule) {
    throw new RecurrenceError('Not a valid recurring template');
  }

  // Validate the rule before writing anything downstream — an unparseable rule
  // should surface as a 400 on create, not as a silent no-op job failure later.
  const rule = parseRecurrenceRule(template.recurrenceRule);

  await createInstance(template as TemplateWithParts, template.date);

  const upcoming = nextOccurrence(rule, template.date, template.date, 1);
  await prisma.expense.update({
    where: { id: template.id },
    data: { nextOccurrenceAt: upcoming },
  });

  return prisma.expense.findFirst({
    where: { recurringTemplateId: template.id },
    include: { payers: true, splits: true },
    orderBy: { date: 'desc' },
  });
}

/** The next due date for a rule starting at `start`, after its first instance. */
export function firstOccurrenceAfter(rule: string, start: Date): Date | null {
  return nextOccurrence(parseRecurrenceRule(rule), start, start, 1);
}
