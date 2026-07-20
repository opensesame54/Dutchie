/**
 * End-to-end smoke test against a running API with seeded data.
 *
 *   npx tsx scripts/smoke.ts
 *
 * Exercises the paths that unit tests cannot: real HTTP, real auth, real
 * database round-trips, and the authorization rules.
 */

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4000';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const eur = (minor: number) => (minor / 100).toFixed(2);

async function login(email: string) {
  const res = await api('/auth/login', {
    method: 'POST',
    body: { email, password: 'dutchie123' },
  });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body as { accessToken: string; refreshToken: string; user: { id: string } };
}

async function main() {
  console.log('\n=== AUTH ===');
  const ana = await login('ana@dutchie.dev');
  const ben = await login('ben@dutchie.dev');
  const dev = await login('dev@dutchie.dev');
  check('login returns an access token', !!ana.accessToken);

  const badLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'ana@dutchie.dev', password: 'wrong' },
  });
  check('wrong password is rejected', badLogin.status === 401);

  const noAuth = await api('/groups');
  check('unauthenticated request is rejected', noAuth.status === 401);

  const me = await api('/auth/me', { token: ana.accessToken });
  check('/me returns the caller', me.body?.user?.email === 'ana@dutchie.dev');

  const refreshed = await api('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: ana.refreshToken },
  });
  check('refresh token rotates', refreshed.status === 200 && !!refreshed.body.accessToken);

  const reused = await api('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: ana.refreshToken },
  });
  check('a rotated refresh token cannot be reused', reused.status === 401);

  console.log('\n=== GROUPS ===');
  const groups = await api('/groups', { token: ana.accessToken });
  const trip = groups.body.groups.find((g: { name: string }) => g.name === 'Lisbon Trip');
  check('seeded groups are listed', groups.body.groups.length === 2, groups.body.groups?.length);
  check('trip has three members', trip?.members?.length === 3);

  const outsider = await api(`/groups/${trip.id}`, { token: dev.accessToken });
  check("a non-member cannot read a group (404, not 403)", outsider.status === 404);

  console.log('\n=== BALANCES ===');
  const bal = await api(`/balances/groups/${trip.id}`, { token: ana.accessToken });
  const names: Record<string, string> = Object.fromEntries(
    bal.body.members.map((m: { id: string; name: string }) => [m.id, m.name.split(' ')[0]]),
  );
  const net = bal.body.balancesByCurrency.EUR as Record<string, number>;

  console.log('  net balances:');
  for (const [uid, amount] of Object.entries(net)) {
    console.log(`    ${names[uid].padEnd(7)} ${eur(amount).padStart(9)}`);
  }

  const sum = Object.values(net).reduce((a, b) => a + b, 0);
  check('group balances sum to zero', sum === 0, sum);

  const anaNet = net[ana.user.id];
  check('Ana is owed EUR 326.36 in the trip', anaNet === 32636, eur(anaNet));

  const pairwise = bal.body.debtsByCurrency.EUR;
  const simplified = bal.body.simplifiedByCurrency.EUR;
  console.log(`  pairwise: ${pairwise.length} payments, simplified: ${simplified.length}`);
  for (const t of simplified) {
    console.log(`    ${names[t.fromUserId]} -> ${names[t.toUserId]}  ${eur(t.amountMinor)}`);
  }
  check('simplification never adds payments', simplified.length <= pairwise.length);

  const settledTotal = simplified.reduce(
    (acc: Record<string, number>, t: { fromUserId: string; toUserId: string; amountMinor: number }) => {
      acc[t.fromUserId] = (acc[t.fromUserId] ?? 0) + t.amountMinor;
      acc[t.toUserId] = (acc[t.toUserId] ?? 0) - t.amountMinor;
      return acc;
    },
    {},
  );
  const allZero = Object.keys(net).every((uid) => (net[uid] ?? 0) + (settledTotal[uid] ?? 0) === 0);
  check('applying the simplified payments settles everyone', allZero);

  console.log('\n=== EXPENSES ===');
  const created = await api('/expenses', {
    method: 'POST',
    token: ana.accessToken,
    body: {
      groupId: trip.id,
      description: 'Pastel de nata run',
      amount: '10.00',
      currency: 'EUR',
      category: 'food',
      splitType: 'EQUAL',
      payers: [{ userId: ana.user.id, amount: '10.00' }],
      participants: [
        { userId: ana.user.id },
        { userId: ben.user.id },
        { userId: Object.keys(names).find((id) => names[id] === 'Chloe')! },
      ],
    },
  });
  check('expense created', created.status === 201, created.body);

  const splitSum = created.body?.expense?.splits?.reduce(
    (a: number, s: { owedAmountMinor: number }) => a + s.owedAmountMinor,
    0,
  );
  check('EUR 10.00 split three ways conserves every cent', splitSum === 1000, splitSum);
  check(
    'the odd cent lands on exactly one person',
    created.body?.expense?.splits?.filter((s: { owedAmountMinor: number }) => s.owedAmountMinor === 334)
      .length === 1,
  );

  const badSplit = await api('/expenses', {
    method: 'POST',
    token: ana.accessToken,
    body: {
      groupId: trip.id,
      description: 'Bad exact split',
      amount: '10.00',
      currency: 'EUR',
      splitType: 'EXACT',
      payers: [{ userId: ana.user.id, amount: '10.00' }],
      participants: [
        { userId: ana.user.id, value: 500 },
        { userId: ben.user.id, value: 400 },
      ],
    },
  });
  check('an exact split that does not add up is rejected', badSplit.status === 400, badSplit.body);

  const outsiderExpense = await api('/expenses', {
    method: 'POST',
    token: ana.accessToken,
    body: {
      groupId: trip.id,
      description: 'Sneaking in a non-member',
      amount: '10.00',
      currency: 'EUR',
      payers: [{ userId: ana.user.id, amount: '10.00' }],
      participants: [{ userId: ana.user.id }, { userId: dev.user.id }],
    },
  });
  check('a non-member cannot be added to a group expense', outsiderExpense.status === 400);

  const overPrecise = await api('/expenses', {
    method: 'POST',
    token: ana.accessToken,
    body: {
      groupId: trip.id,
      description: 'Fractional cent',
      amount: '10.005',
      currency: 'EUR',
      payers: [{ userId: ana.user.id, amount: '10.005' }],
      participants: [{ userId: ana.user.id }],
    },
  });
  check('sub-cent precision is rejected', overPrecise.status >= 400);

  const search = await api(`/expenses?groupId=${trip.id}&search=pastel`, {
    token: ana.accessToken,
  });
  check('search finds the new expense', search.body.expenses.length === 1, search.body.expenses.length);

  const deleted = await api(`/expenses/${created.body.expense.id}`, {
    method: 'DELETE',
    token: ana.accessToken,
  });
  check('expense deleted', deleted.status === 204);

  const afterDelete = await api(`/balances/groups/${trip.id}`, { token: ana.accessToken });
  check(
    'deleting an expense restores the previous balance',
    afterDelete.body.balancesByCurrency.EUR[ana.user.id] === anaNet,
  );

  console.log('\n=== SETTLE UP ===');
  const settle = await api('/settlements', {
    method: 'POST',
    token: ben.accessToken,
    body: {
      groupId: trip.id,
      fromUserId: ben.user.id,
      toUserId: ana.user.id,
      amount: '78.13',
      currency: 'EUR',
      method: 'CASH',
    },
  });
  check('settlement recorded', settle.status === 201, settle.body);

  const afterSettle = await api(`/balances/groups/${trip.id}`, { token: ana.accessToken });
  check(
    "settling Ben's exact balance zeroes him out",
    afterSettle.body.balancesByCurrency.EUR[ben.user.id] === undefined,
    afterSettle.body.balancesByCurrency.EUR[ben.user.id],
  );

  const thirdParty = await api('/settlements', {
    method: 'POST',
    token: dev.accessToken,
    body: {
      groupId: trip.id,
      fromUserId: ben.user.id,
      toUserId: ana.user.id,
      amount: '5.00',
      currency: 'EUR',
    },
  });
  check('an uninvolved user cannot record a payment', thirdParty.status >= 400);

  // Undo, so re-running the smoke test starts from the same place.
  await api(`/settlements/${settle.body.settlement.id}`, {
    method: 'DELETE',
    token: ben.accessToken,
  });

  console.log('\n=== MEMBERSHIP ===');
  const removeOwing = await api(`/groups/${trip.id}/members/${ben.user.id}`, {
    method: 'DELETE',
    token: ana.accessToken,
  });
  check('a member with an outstanding balance cannot be removed', removeOwing.status === 409);

  console.log('\n=== ACTIVITY ===');
  const activity = await api(`/activity?groupId=${trip.id}`, { token: ana.accessToken });
  check('activity feed is populated', activity.body.activity.length > 0);
  check(
    'deleted expenses still appear in the feed',
    activity.body.activity.some((a: { actionType: string }) => a.actionType === 'EXPENSE_DELETED'),
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
