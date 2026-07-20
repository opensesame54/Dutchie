/**
 * Scheduled jobs. Run from cron, a platform scheduler (Railway/Render cron), or
 * manually:
 *
 *   npm run job:recurring   # materialise due recurring expenses
 *   npm run job:rates       # refresh today's FX rates
 *   npm run job:all         # both, in order
 *
 * Each job is idempotent, so running them more often than necessary is safe —
 * which matters because platform schedulers retry and occasionally double-fire.
 */

import { prisma } from '../src/db';
import { generateDueExpenses } from '../src/services/recurringService';
import { syncDailyRates } from '../src/services/exchangeRateService';

async function runRecurring() {
  const result = await generateDueExpenses();
  console.log(
    `[recurring] scanned ${result.templatesScanned} template(s), ` +
      `created ${result.expensesCreated} expense(s), ` +
      `completed ${result.templatesCompleted} series`,
  );
  for (const err of result.errors) {
    console.error(`[recurring] template ${err.templateId} failed: ${err.message}`);
  }
  // A partial failure should be visible to the scheduler.
  return result.errors.length === 0;
}

async function runRates() {
  const result = await syncDailyRates();
  if (result.error) {
    console.warn(`[rates] provider unavailable (${result.error}); using cached rates`);
    return true; // Not fatal — stale rates still beat no balances.
  }
  console.log(`[rates] ${result.date}: ${result.ratesStored} rate(s) from ${result.source}`);
  return true;
}

async function main() {
  const which = process.argv[2] ?? 'all';
  let ok = true;

  if (which === 'rates' || which === 'all') ok = (await runRates()) && ok;
  if (which === 'recurring' || which === 'all') ok = (await runRecurring()) && ok;

  if (!['rates', 'recurring', 'all'].includes(which)) {
    console.error(`Unknown job "${which}". Expected: recurring | rates | all`);
    process.exit(2);
  }

  process.exit(ok ? 0 : 1);
}

main()
  .catch((err) => {
    console.error('Job failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
