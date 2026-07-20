/**
 * End-to-end checks for the second wave of features: recurring generation,
 * notifications, FX conversion, and CSV export.
 *
 *   npx tsx scripts/smokeFeatures.ts   (needs a running API + seeded DB)
 */

import { prisma } from '../src/db';
import { generateDueExpenses } from '../src/services/recurringService';
import { computeGroupBalances } from '../src/services/balanceService';
import { rateToScaled } from '../src/money/conversion';
import { startOfUtcDay } from '../src/core/recurrence';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4000';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  const isJson = res.headers.get('content-type')?.includes('json');
  return { status: res.status, body: isJson && text ? JSON.parse(text) : text };
}

async function login(email: string) {
  const res = await api('/auth/login', {
    method: 'POST',
    body: { email, password: 'dutchie123' },
  });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body as { accessToken: string; user: { id: string } };
}

async function main() {
  const ana = await login('ana@dutchie.dev');
  const chloe = await login('chloe@dutchie.dev');

  const flat = await prisma.group.findFirstOrThrow({ where: { name: 'Flat 3B' } });

  console.log('\n=== RECURRING: templates are excluded from balances ===');
  const templates = await prisma.expense.findMany({
    where: { isTemplate: true, groupId: flat.id },
  });
  check('seed created recurring templates', templates.length === 2, templates.length);

  const instances = await prisma.expense.count({
    where: { recurringTemplateId: { in: templates.map((t) => t.id) } },
  });
  check('each template has one materialised instance', instances === 2, instances);

  const before = await computeGroupBalances(flat.id);
  const beforeNet = { ...before.balancesByCurrency.EUR };
  const netSum = Object.values(beforeNet).reduce((a, b) => a + b, 0);
  check('flat balances still sum to zero', netSum === 0, netSum);
  // The rent template must not be double-counted: Ana is owed 548.37 exactly,
  // the same figure as before recurrence existed.
  check('template is not counted as spend', beforeNet[ana.user.id] === 54_837, beforeNet[ana.user.id]);

  console.log('\n=== RECURRING: generation, catch-up and idempotence ===');
  const rentTemplate = templates.find((t) => t.description === 'October rent')!;

  // Backdate the template so several months are due, simulating a job that
  // has not run for a while.
  await prisma.expense.update({
    where: { id: rentTemplate.id },
    data: { nextOccurrenceAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
  });

  const run1 = await generateDueExpenses();
  check('generator created the missed occurrences', run1.expensesCreated > 0, run1);

  const afterFirst = await prisma.expense.count({
    where: { recurringTemplateId: rentTemplate.id },
  });

  // The critical property: running again must be a no-op.
  const run2 = await generateDueExpenses();
  const afterSecond = await prisma.expense.count({
    where: { recurringTemplateId: rentTemplate.id },
  });

  check('a second run creates nothing (idempotent)', run2.expensesCreated === 0, run2);
  check('instance count is unchanged by the re-run', afterFirst === afterSecond, {
    afterFirst, afterSecond,
  });

  const dates = await prisma.expense.findMany({
    where: { recurringTemplateId: rentTemplate.id },
    select: { date: true },
  });
  const unique = new Set(dates.map((d) => d.date.toISOString()));
  check('no duplicate occurrence dates', unique.size === dates.length, {
    total: dates.length, unique: unique.size,
  });

  const afterGen = await computeGroupBalances(flat.id);
  const genSum = Object.values(afterGen.balancesByCurrency.EUR).reduce((a, b) => a + b, 0);
  check('balances still sum to zero after generation', genSum === 0, genSum);
  check(
    'generated rent actually moved the balance',
    afterGen.balancesByCurrency.EUR[ana.user.id] > beforeNet[ana.user.id],
    { before: beforeNet[ana.user.id], after: afterGen.balancesByCurrency.EUR[ana.user.id] },
  );

  const listed = await api(`/expenses?groupId=${flat.id}`, { token: ana.accessToken });
  const hasTemplate = listed.body.expenses.some((e: { id: string }) => e.id === rentTemplate.id);
  check('templates do not appear in the expense feed', !hasTemplate);

  const templateList = await api(`/expenses/recurring/templates?groupId=${flat.id}`, {
    token: ana.accessToken,
  });
  check('templates are listed on their own endpoint', templateList.body.templates.length === 2);

  console.log('\n=== NOTIFICATIONS ===');
  await prisma.notification.deleteMany();

  const newExpense = await api('/expenses', {
    method: 'POST',
    token: ana.accessToken,
    body: {
      groupId: flat.id,
      description: 'Notification probe',
      amount: '20.00',
      currency: 'EUR',
      splitType: 'EQUAL',
      payers: [{ userId: ana.user.id, amount: '20.00' }],
      participants: [{ userId: ana.user.id }, { userId: chloe.user.id }],
    },
  });
  check('expense created', newExpense.status === 201, newExpense.body);

  const chloeNotes = await api('/notifications', { token: chloe.accessToken });
  check('the other participant was notified', chloeNotes.body.notifications.length === 1, chloeNotes.body);
  check('unread count is reported', chloeNotes.body.unreadCount === 1);

  const anaNotes = await api('/notifications', { token: ana.accessToken });
  check('the creator is not notified about their own expense', anaNotes.body.notifications.length === 0);

  const marked = await api('/notifications/read', { method: 'POST', token: chloe.accessToken, body: {} });
  check('notifications can be marked read', marked.body.marked === 1, marked.body);

  const afterRead = await api('/notifications', { token: chloe.accessToken });
  check('unread count drops to zero', afterRead.body.unreadCount === 0);

  const device = await api('/notifications/devices', {
    method: 'POST',
    token: chloe.accessToken,
    body: { token: 'ExponentPushToken[smoke-test-xxxxxxxx]', platform: 'android' },
  });
  check('device token registered', device.status === 201, device.body);

  // Re-registering the same token under another account must move ownership,
  // not duplicate or 500.
  const reassign = await api('/notifications/devices', {
    method: 'POST',
    token: ana.accessToken,
    body: { token: 'ExponentPushToken[smoke-test-xxxxxxxx]', platform: 'android' },
  });
  const owner = await prisma.deviceToken.findUnique({
    where: { token: 'ExponentPushToken[smoke-test-xxxxxxxx]' },
  });
  check('re-registering a token reassigns it', reassign.status === 201 && owner?.userId === ana.user.id);

  const prefs = await api('/notifications/preferences', {
    method: 'PATCH',
    token: chloe.accessToken,
    body: { notifyOnExpense: false },
  });
  check('preferences update', prefs.body.preferences.notifyOnExpense === false);

  await prisma.notification.deleteMany();
  await api('/expenses', {
    method: 'POST',
    token: ana.accessToken,
    body: {
      groupId: flat.id,
      description: 'Muted probe',
      amount: '10.00',
      currency: 'EUR',
      splitType: 'EQUAL',
      payers: [{ userId: ana.user.id, amount: '10.00' }],
      participants: [{ userId: ana.user.id }, { userId: chloe.user.id }],
    },
  });
  const muted = await api('/notifications', { token: chloe.accessToken });
  check('opting out actually suppresses the notification', muted.body.notifications.length === 0);

  // Restore for repeat runs.
  await api('/notifications/preferences', {
    method: 'PATCH', token: chloe.accessToken, body: { notifyOnExpense: true },
  });

  console.log('\n=== MULTI-CURRENCY ===');
  // Seed deterministic rates rather than depending on a live provider.
  const today = startOfUtcDay(new Date());
  await prisma.exchangeRate.deleteMany({ where: { date: today } });
  await prisma.exchangeRate.createMany({
    data: [
      { baseCurrency: 'USD', quoteCurrency: 'EUR', rateScaled: rateToScaled(0.9), date: today },
      { baseCurrency: 'USD', quoteCurrency: 'USD', rateScaled: rateToScaled(1), date: today },
    ],
  });

  const summary = await api('/balances/summary?displayCurrency=EUR', { token: ana.accessToken });
  check('summary reports a converted total', typeof summary.body.converted?.net === 'number', summary.body.converted);
  check('converted total is in the requested currency', summary.body.converted.currency === 'EUR');
  check(
    'per-currency breakdown is still returned alongside',
    typeof summary.body.totalsByCurrency === 'object',
  );

  // Ana's balances are EUR-only, so the EUR total must match exactly.
  const eurNet = summary.body.totalsByCurrency.EUR?.net ?? 0;
  check('EUR balances convert 1:1 into an EUR display total', summary.body.converted.net === eurNet, {
    converted: summary.body.converted.net, eurNet,
  });

  const noRate = await api('/balances/summary?displayCurrency=JPY', { token: ana.accessToken });
  check(
    'a currency with no rate is reported, not silently dropped',
    noRate.body.converted.unconvertible.includes('EUR'),
    noRate.body.converted,
  );

  console.log('\n=== OFFLINE IDEMPOTENCY ===');
  const key = `smoke-${Date.now()}`;
  const payload = {
    groupId: flat.id,
    description: 'Queued while offline',
    amount: '15.00',
    currency: 'EUR',
    splitType: 'EQUAL' as const,
    clientRequestId: key,
    payers: [{ userId: ana.user.id, amount: '15.00' }],
    participants: [{ userId: ana.user.id }, { userId: chloe.user.id }],
  };

  const first = await api('/expenses', { method: 'POST', token: ana.accessToken, body: payload });
  check('queued expense is created', first.status === 201, first.body);

  // The exact scenario an interrupted outbox flush produces: same key, resent.
  const replay = await api('/expenses', { method: 'POST', token: ana.accessToken, body: payload });
  check('a replayed submission is deduplicated', replay.status === 200 && replay.body.deduplicated === true, replay.body);
  check('the replay returns the original expense', replay.body.expense?.id === first.body.expense.id);

  const dupes = await prisma.expense.count({ where: { clientRequestId: key } });
  check('only one expense exists for the key', dupes === 1, dupes);

  console.log('\n=== CSV EXPORT ===');
  const csv = await api(`/exports/groups/${flat.id}.csv`, { token: ana.accessToken });
  const text = String(csv.body);
  check('export returns CSV', csv.status === 200 && text.includes('Date,Type,Description'));
  check('export includes expense rows', text.includes('October rent'));
  check('export includes a settlement or member column', text.includes('share'));

  const outsider = await login('ben@dutchie.dev');
  const denied = await api(`/exports/groups/${flat.id}.csv`, { token: outsider.accessToken });
  check('a non-member cannot export the ledger', denied.status === 404, denied.status);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Feature smoke crashed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
