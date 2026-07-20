# Dutchie

> Splitwise but for me

A Splitwise-style expense splitter. Express + Prisma + PostgreSQL on the back,
React Native (Expo) on the front, TypeScript throughout.

```
server/   Express API, Prisma schema, balance engine, tests
mobile/   Expo app (Android-first)
```

## Status

Implemented and verified:

| Area | State |
|---|---|
| Data model + migrations + seed | Done |
| Auth (signup/login/refresh/reset, JWT + rotating refresh tokens) | Done |
| Groups, members, invite links | Done |
| Expenses CRUD, all four split types, multiple payers, comments | Done |
| Balances, settle up, debt simplification | Done, unit tested |
| Friends + direct expenses | Done |
| Activity feed | Done |
| Mobile: auth, dashboard, groups, group detail, add expense, settle up, friends, settings | Done |
| Push notifications, multi-currency conversion, offline sync, receipts, recurring generation, charts, CSV export | **Not started** |

See "What is not built yet" at the bottom for detail.

## Setup

### 1. Database

Requires PostgreSQL 14+. Create a role and database:

```bash
sudo -u postgres psql -c "CREATE ROLE dutchie LOGIN PASSWORD 'dutchie';"
sudo -u postgres psql -c "CREATE DATABASE dutchie OWNER dutchie;"
```

### 2. API

```bash
cd server
cp .env.example .env          # then edit DATABASE_URL and the JWT secrets
npm install
npx prisma migrate deploy     # or `npm run db:migrate` in development
npm run db:seed
npm run dev                   # http://localhost:4000
```

Generate real secrets with `openssl rand -base64 32`. The server refuses to
boot in production while the placeholder values are still in place.

### 3. Mobile app

```bash
cd mobile
cp .env.example .env
npm install
npx expo start
```

The API URL resolution matters and is the most common setup snag:

| Target | `EXPO_PUBLIC_API_URL` |
|---|---|
| Android emulator | `http://10.0.2.2:4000` (the default — `localhost` on an emulator is the emulator itself) |
| Physical device | `http://<your-machine-LAN-IP>:4000`, on the same Wi-Fi |
| Production | your deployed HTTPS origin |

Because this project uses `expo-dev-client`, a plain Expo Go build will not
load the native modules. Build a dev client once per device:

```bash
npx expo run:android              # local build, needs Android SDK
# or
eas build --profile development --platform android
```

### Demo accounts

After seeding: `ana@dutchie.dev`, `ben@dutchie.dev`, `chloe@dutchie.dev`,
`dev@dutchie.dev` — all with password `dutchie123`.

The seed builds a Lisbon trip (3 people, every split type, one part-payment)
and a shared flat (2 people, recurring rent split 3:2), plus one groupless
direct expense, so balances are non-trivial on first launch.

## Tests

```bash
cd server
npm test          # 82 unit tests over the money/balance/simplification logic
npm run smoke     # 28 end-to-end checks against a running API + seeded DB
```

The unit tests cover the parts that must not be wrong: allocation, split types,
balance calculation, and debt simplification — including the edge cases that
break naive implementations (a member leaving mid-trip, an expense edited after
a settlement, three-way circular debt, a settlement that overshoots the debt).
Both allocation and simplification are additionally swept with randomised
inputs asserting that money is conserved and everyone ends at zero.

## How the money works

Read this before touching anything in `server/src/core/`.

**Everything is integer minor units.** No floats anywhere in the money path.
`0.1 + 0.2 !== 0.3`, and a rounding drift in a ledger is a real bug, not a
cosmetic one. Amounts cross the API as decimal *strings* (`"12.34"`) and are
converted at the boundary by `src/money/currency.ts`, which also knows that JPY
has no minor unit and KWD has three.

**Splits always sum to the total.** `allocate()` uses the largest-remainder
method: floor every share, then hand the leftover units to whoever was rounded
down hardest, breaking ties by index so the result is deterministic. $10.00
three ways is 3.34 / 3.33 / 3.33 — never three times 3.33 with a cent lost.

**Debt simplification is deliberately not optimal.** Finding the true minimum
number of transactions is NP-hard. `simplifyDebts()` cancels exact matches
first, then greedily matches the largest debtor against the largest creditor.
It always settles everyone in at most n-1 payments. It is occasionally one
payment above optimal in adversarial cases, and that trade is intentional —
the settle-up screen must be instant and exactly right about amounts, and
being provably minimal matters less than either.

**Pairwise balances are not simplified.** A friend-to-friend balance shows what
those two people actually shared. Simplification is a separate, opt-in view, so
the app never tells you to pay someone you have never met without saying why.

## API

All routes are under `/api`, all except auth require `Authorization: Bearer <accessToken>`.

```
POST   /auth/signup                     PATCH  /auth/me
POST   /auth/login                      POST   /auth/forgot-password
POST   /auth/refresh                    POST   /auth/reset-password
POST   /auth/logout                     GET    /auth/me

GET    /groups                          POST   /groups
GET    /groups/:id                      PATCH  /groups/:id
POST   /groups/:id/members              DELETE /groups/:id/members/:userId
POST   /groups/join/:inviteCode

GET    /expenses  (?groupId|friendId|search|category|paidBy|from|to|limit|cursor)
POST   /expenses                        GET    /expenses/:id
PUT    /expenses/:id                    DELETE /expenses/:id
GET    /expenses/:id/comments           POST   /expenses/:id/comments

GET    /settlements                     POST   /settlements
DELETE /settlements/:id

GET    /balances/summary                GET    /balances/groups/:groupId

GET    /friends                         DELETE /friends/:friendId
GET    /friends/requests                POST   /friends/requests
POST   /friends/requests/:id/respond

GET    /activity  (?groupId|limit|cursor)
```

Authorization is centralised in `server/src/access.ts` — membership is checked
in one place rather than re-implemented per handler. Non-members get 404 rather
than 403, so the API does not confirm that a group exists to someone outside it.

## Deploying

The API is deploy-ready for Railway or Render:

- Build: `npm run build`
- Start: `npm start`
- Release/pre-deploy: `npx prisma migrate deploy`
- Set `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `NODE_ENV=production`

`app.set('trust proxy', 1)` is already set so rate limiting sees real client IPs
behind the platform proxy.

For the app, `eas build --profile preview --platform android` produces an APK
for internal testing. You will need to run `eas init` first to attach a project
ID.

## What is not built yet

Deliberately deferred, roughly in the order they should be picked up:

1. **Push notifications** — Expo Notifications + FCM. No `expo-notifications`
   wiring or device-token storage exists yet.
2. **Multi-currency display conversion** — expenses already carry their own
   currency and balances are correctly partitioned per currency (they are never
   summed across currencies), but there is no exchange-rate fetch, so a user
   with EUR and USD balances sees them separately rather than converted to one
   display currency.
3. **Offline caching and sync** — TanStack Query is in place but not persisted;
   there is no AsyncStorage/SQLite cache and no outbox for queued expenses.
   Currently a cold start with no connection shows empty states.
4. **Receipt photos** — `receiptUrl` exists on the model and API, but there is
   no image picker or S3 upload path.
5. **Recurring expense generation** — expenses store `isRecurring` and an RRULE
   string, and the seed uses them, but nothing generates the next occurrence.
   Needs a scheduled job.
6. **Optimistic UI** — mutations currently invalidate and refetch. The brief
   asked for optimistic updates with rollback; that is a follow-up on top of the
   existing mutation hooks.
7. **Editing expenses from the app** — the API supports `PUT /expenses/:id`
   fully; the mobile app only creates and lists.
8. **Charts, CSV/PDF export, group budgets, friend-request UI.**

## Known gaps and caveats

- **Nothing has been run on a real Android device or emulator.** The app
  typechecks and the production Android bundle exports cleanly (1207 modules),
  but no screen has been rendered. Keyboard behaviour, back-gesture handling,
  notification permissions, and safe-area insets all need a real device pass
  before this milestone can honestly be called done.
- The `mobile/.env` API URL defaults to the Android emulator host. On a
  physical device it must be set to your machine's LAN IP.
- Password reset tokens are logged to the server console in development; no
  transactional email is wired up.
- `Intl` support under Hermes has not been verified on-device. `formatMinor`
  uses `toLocaleString` for thousands separators, which is the one place that
  would show up if the runtime lacks full ICU.
