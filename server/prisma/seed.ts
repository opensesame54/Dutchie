import bcrypt from 'bcryptjs';
import { prisma } from '../src/db';
import { computeSplits, type SplitType } from '../src/core/splits';
import { firstOccurrenceAfter } from '../src/services/recurringService';
import { toMinorUnits } from '../src/money/currency';

/**
 * Realistic demo data: a Lisbon trip and a shared flat, with every split type
 * represented and a couple of settlements already recorded, so the app has
 * something worth looking at on first launch.
 *
 * Every account uses the password below.
 */
const DEMO_PASSWORD = 'dutchie123';

const PEOPLE = [
  { key: 'ana', name: 'Ana Ferreira', email: 'ana@dutchie.dev', currency: 'EUR' },
  { key: 'ben', name: 'Ben Okafor', email: 'ben@dutchie.dev', currency: 'USD' },
  { key: 'chloe', name: 'Chloe Martin', email: 'chloe@dutchie.dev', currency: 'EUR' },
  { key: 'dev', name: 'Dev Patel', email: 'dev@dutchie.dev', currency: 'USD' },
] as const;

type PersonKey = (typeof PEOPLE)[number]['key'];

async function main() {
  console.log('Resetting demo data...');

  // Order matters: children before parents, since some relations restrict.
  await prisma.notification.deleteMany();
  await prisma.deviceToken.deleteMany();
  await prisma.exchangeRate.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.expenseSplit.deleteMany();
  await prisma.expensePayer.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.friendship.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.passwordReset.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = {} as Record<PersonKey, { id: string; name: string }>;

  for (const person of PEOPLE) {
    const user = await prisma.user.create({
      data: {
        name: person.name,
        email: person.email,
        passwordHash,
        defaultCurrency: person.currency,
      },
    });
    users[person.key] = { id: user.id, name: user.name };
  }

  console.log(`Created ${PEOPLE.length} users`);

  // Friendships: Ana <-> everyone, plus Ben <-> Chloe.
  await prisma.friendship.createMany({
    data: [
      { requesterId: users.ana.id, addresseeId: users.ben.id, status: 'ACCEPTED' },
      { requesterId: users.ana.id, addresseeId: users.chloe.id, status: 'ACCEPTED' },
      { requesterId: users.ben.id, addresseeId: users.chloe.id, status: 'ACCEPTED' },
      // One pending request so the requests screen is not empty.
      { requesterId: users.dev.id, addresseeId: users.ana.id, status: 'PENDING' },
    ],
  });

  const trip = await prisma.group.create({
    data: {
      name: 'Lisbon Trip',
      type: 'TRIP',
      defaultCurrency: 'EUR',
      createdById: users.ana.id,
      members: {
        create: [
          { userId: users.ana.id, role: 'ADMIN' },
          { userId: users.ben.id },
          { userId: users.chloe.id },
        ],
      },
    },
  });

  const flat = await prisma.group.create({
    data: {
      name: 'Flat 3B',
      type: 'HOME',
      defaultCurrency: 'EUR',
      createdById: users.ana.id,
      members: {
        create: [
          { userId: users.ana.id, role: 'ADMIN' },
          { userId: users.chloe.id },
        ],
      },
    },
  });

  console.log('Created 2 groups');

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  async function addExpense(opts: {
    groupId: string | null;
    description: string;
    amount: string;
    currency: string;
    category: string;
    date: Date;
    splitType: SplitType;
    paidBy: { userId: string; amount: string }[];
    participants: { userId: string; value?: number }[];
    createdById: string;
    notes?: string;
    isRecurring?: boolean;
    recurrenceRule?: string;
  }) {
    const totalMinor = toMinorUnits(opts.amount, opts.currency);
    const splits = computeSplits(totalMinor, opts.splitType, opts.participants);

    const expense = await prisma.expense.create({
      data: {
        groupId: opts.groupId,
        description: opts.description,
        amountMinor: totalMinor,
        currency: opts.currency,
        category: opts.category,
        date: opts.date,
        notes: opts.notes ?? null,
        splitType: opts.splitType,
        createdById: opts.createdById,
        isRecurring: opts.isRecurring ?? false,
        recurrenceRule: opts.recurrenceRule ?? null,
        // A recurring seed row is a TEMPLATE: excluded from balances, it only
        // spawns instances. The instance carrying the money is created below,
        // so the resulting balances are identical to a one-off expense.
        isTemplate: opts.isRecurring ?? false,
        nextOccurrenceAt:
          opts.isRecurring && opts.recurrenceRule
            ? firstOccurrenceAfter(opts.recurrenceRule, opts.date)
            : null,
        payers: {
          create: opts.paidBy.map((p) => ({
            userId: p.userId,
            amountMinor: toMinorUnits(p.amount, opts.currency),
          })),
        },
        splits: {
          create: splits.map((s) => ({
            userId: s.userId,
            owedAmountMinor: s.owedAmountMinor,
            shareValue: s.shareValue,
          })),
        },
      },
    });

    // Materialise the first occurrence so the template has real spend behind it.
    if (opts.isRecurring) {
      await prisma.expense.create({
        data: {
          groupId: opts.groupId,
          description: opts.description,
          amountMinor: totalMinor,
          currency: opts.currency,
          category: opts.category,
          date: opts.date,
          notes: opts.notes ?? null,
          splitType: opts.splitType,
          createdById: opts.createdById,
          recurringTemplateId: expense.id,
          payers: {
            create: opts.paidBy.map((p) => ({
              userId: p.userId,
              amountMinor: toMinorUnits(p.amount, opts.currency),
            })),
          },
          splits: {
            create: splits.map((s) => ({
              userId: s.userId,
              owedAmountMinor: s.owedAmountMinor,
              shareValue: s.shareValue,
            })),
          },
        },
      });
    }

    await prisma.activityLog.create({
      data: {
        groupId: opts.groupId,
        userId: opts.createdById,
        actionType: 'EXPENSE_CREATED',
        targetId: expense.id,
        createdAt: opts.date,
        metadata: {
          description: opts.description,
          amountMinor: totalMinor,
          currency: opts.currency,
        },
      },
    });

    return expense;
  }

  const { ana, ben, chloe } = users;

  // --- Lisbon trip: every split type gets an outing ---------------------

  await addExpense({
    groupId: trip.id,
    description: 'Airbnb in Alfama',
    amount: '840.00',
    currency: 'EUR',
    category: 'lodging',
    date: daysAgo(21),
    splitType: 'EQUAL',
    paidBy: [{ userId: ana.id, amount: '840.00' }],
    participants: [{ userId: ana.id }, { userId: ben.id }, { userId: chloe.id }],
    createdById: ana.id,
    notes: 'Three nights, includes the cleaning fee',
  });

  // Deliberately awkward: 100.00 three ways exercises the rounding path.
  await addExpense({
    groupId: trip.id,
    description: 'Dinner at Time Out Market',
    amount: '100.00',
    currency: 'EUR',
    category: 'food',
    date: daysAgo(20),
    splitType: 'EQUAL',
    paidBy: [{ userId: ben.id, amount: '100.00' }],
    participants: [{ userId: ana.id }, { userId: ben.id }, { userId: chloe.id }],
    createdById: ben.id,
  });

  // Chloe skipped the surf lesson — exact amounts, she owes nothing.
  await addExpense({
    groupId: trip.id,
    description: 'Surf lesson',
    amount: '90.00',
    currency: 'EUR',
    category: 'activities',
    date: daysAgo(19),
    splitType: 'EXACT',
    paidBy: [{ userId: chloe.id, amount: '90.00' }],
    participants: [
      { userId: ana.id, value: 4500 },
      { userId: ben.id, value: 4500 },
      { userId: chloe.id, value: 0 },
    ],
    createdById: chloe.id,
    notes: 'Chloe watched from the beach',
  });

  // Two people chipped in for one bill.
  await addExpense({
    groupId: trip.id,
    description: 'Rental car + petrol',
    amount: '235.50',
    currency: 'EUR',
    category: 'transport',
    date: daysAgo(18),
    splitType: 'PERCENTAGE',
    paidBy: [
      { userId: ana.id, amount: '150.00' },
      { userId: ben.id, amount: '85.50' },
    ],
    participants: [
      { userId: ana.id, value: 4000 },
      { userId: ben.id, value: 4000 },
      { userId: chloe.id, value: 2000 },
    ],
    createdById: ana.id,
    notes: 'Chloe only joined for the day trip',
  });

  await addExpense({
    groupId: trip.id,
    description: 'Train to Sintra',
    amount: '33.30',
    currency: 'EUR',
    category: 'transport',
    date: daysAgo(17),
    splitType: 'EQUAL',
    paidBy: [{ userId: chloe.id, amount: '33.30' }],
    participants: [{ userId: ana.id }, { userId: ben.id }, { userId: chloe.id }],
    createdById: chloe.id,
  });

  // --- Flat 3B: recurring household costs -------------------------------

  await addExpense({
    groupId: flat.id,
    description: 'October rent',
    amount: '1400.00',
    currency: 'EUR',
    category: 'rent',
    date: daysAgo(30),
    // Ana has the larger bedroom, so 3:2 rather than an even split.
    splitType: 'SHARES',
    paidBy: [{ userId: ana.id, amount: '1400.00' }],
    participants: [
      { userId: ana.id, value: 3 },
      { userId: chloe.id, value: 2 },
    ],
    createdById: ana.id,
    isRecurring: true,
    recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=1',
  });

  await addExpense({
    groupId: flat.id,
    description: 'Electricity',
    amount: '87.45',
    currency: 'EUR',
    category: 'utilities',
    date: daysAgo(12),
    splitType: 'EQUAL',
    paidBy: [{ userId: chloe.id, amount: '87.45' }],
    participants: [{ userId: ana.id }, { userId: chloe.id }],
    createdById: chloe.id,
    isRecurring: true,
    recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=15',
  });

  await addExpense({
    groupId: flat.id,
    description: 'Weekly shop',
    amount: '64.20',
    currency: 'EUR',
    category: 'groceries',
    date: daysAgo(5),
    splitType: 'EQUAL',
    paidBy: [{ userId: ana.id, amount: '64.20' }],
    participants: [{ userId: ana.id }, { userId: chloe.id }],
    createdById: ana.id,
  });

  // --- A direct expense with no group -----------------------------------

  const concert = await addExpense({
    groupId: null,
    description: 'Concert tickets',
    amount: '120.00',
    currency: 'USD',
    category: 'entertainment',
    date: daysAgo(9),
    splitType: 'EQUAL',
    paidBy: [{ userId: ben.id, amount: '120.00' }],
    participants: [{ userId: ben.id }, { userId: users.dev.id }],
    createdById: ben.id,
  });

  await prisma.comment.createMany({
    data: [
      { expenseId: concert.id, userId: users.dev.id, text: 'Worth every cent' },
      { expenseId: concert.id, userId: ben.id, text: "I'll take a transfer whenever" },
    ],
  });

  // --- Partial settlements, so balances are not all pristine -------------

  const settlement = await prisma.settlement.create({
    data: {
      groupId: trip.id,
      fromUserId: ben.id,
      toUserId: ana.id,
      amountMinor: toMinorUnits('200.00', 'EUR'),
      currency: 'EUR',
      date: daysAgo(10),
      method: 'BANK',
      note: 'Part payment for the Airbnb',
    },
  });

  await prisma.activityLog.create({
    data: {
      groupId: trip.id,
      userId: ben.id,
      actionType: 'SETTLEMENT_CREATED',
      targetId: settlement.id,
      createdAt: daysAgo(10),
      metadata: {
        amountMinor: settlement.amountMinor,
        currency: 'EUR',
        fromUserId: ben.id,
        toUserId: ana.id,
      },
    },
  });

  console.log('\nSeed complete.');
  console.log(`  Accounts: ${PEOPLE.map((p) => p.email).join(', ')}`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log(`  Groups:   Lisbon Trip (3 people), Flat 3B (2 people)`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
