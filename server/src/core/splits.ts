import { allocate } from './allocate';

export type SplitType = 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'SHARES';

export interface SplitInput {
  userId: string;
  /**
   * Meaning depends on split type:
   *   EQUAL      — ignored (every listed participant gets an equal share)
   *   EXACT      — the exact amount in minor units this user owes
   *   PERCENTAGE — basis points (2500 = 25%), must total 10000
   *   SHARES     — share count (2 vs 1 means "twice as much")
   */
  value?: number;
}

export interface ComputedSplit {
  userId: string;
  owedAmountMinor: number;
  shareValue: number | null;
}

export class SplitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitValidationError';
  }
}

const BASIS_POINTS = 10_000;

/**
 * Turn a user's split intent into concrete owed amounts that sum to exactly
 * `totalMinor`.
 */
export function computeSplits(
  totalMinor: number,
  splitType: SplitType,
  participants: SplitInput[],
): ComputedSplit[] {
  if (!Number.isInteger(totalMinor)) {
    throw new SplitValidationError('Expense total must be an integer number of minor units');
  }
  if (totalMinor <= 0) {
    throw new SplitValidationError('Expense total must be greater than zero');
  }
  if (participants.length === 0) {
    throw new SplitValidationError('An expense needs at least one participant');
  }

  const seen = new Set<string>();
  for (const p of participants) {
    if (seen.has(p.userId)) {
      throw new SplitValidationError(`Duplicate participant in split: ${p.userId}`);
    }
    seen.add(p.userId);
  }

  switch (splitType) {
    case 'EQUAL': {
      const amounts = allocate(totalMinor, participants.map(() => 1));
      return participants.map((p, i) => ({
        userId: p.userId,
        owedAmountMinor: amounts[i],
        shareValue: null,
      }));
    }

    case 'EXACT': {
      const values = requireValues(participants, 'EXACT');
      if (values.some((v) => v < 0)) {
        throw new SplitValidationError('Exact split amounts cannot be negative');
      }
      const sum = values.reduce((a, b) => a + b, 0);
      if (sum !== totalMinor) {
        throw new SplitValidationError(
          `Exact split amounts total ${sum} but the expense is ${totalMinor}`,
        );
      }
      return participants.map((p, i) => ({
        userId: p.userId,
        owedAmountMinor: values[i],
        shareValue: values[i],
      }));
    }

    case 'PERCENTAGE': {
      const values = requireValues(participants, 'PERCENTAGE');
      if (values.some((v) => v < 0)) {
        throw new SplitValidationError('Percentages cannot be negative');
      }
      const sum = values.reduce((a, b) => a + b, 0);
      if (sum !== BASIS_POINTS) {
        throw new SplitValidationError(
          `Percentages must total 100% (10000 basis points), got ${sum}`,
        );
      }
      const amounts = allocate(totalMinor, values);
      return participants.map((p, i) => ({
        userId: p.userId,
        owedAmountMinor: amounts[i],
        shareValue: values[i],
      }));
    }

    case 'SHARES': {
      const values = requireValues(participants, 'SHARES');
      if (values.some((v) => v < 0)) {
        throw new SplitValidationError('Share counts cannot be negative');
      }
      if (values.reduce((a, b) => a + b, 0) === 0) {
        throw new SplitValidationError('Share counts must total more than zero');
      }
      const amounts = allocate(totalMinor, values);
      return participants.map((p, i) => ({
        userId: p.userId,
        owedAmountMinor: amounts[i],
        shareValue: values[i],
      }));
    }

    default: {
      const exhaustive: never = splitType;
      throw new SplitValidationError(`Unknown split type: ${exhaustive}`);
    }
  }
}

function requireValues(participants: SplitInput[], type: string): number[] {
  return participants.map((p) => {
    if (p.value === undefined || p.value === null) {
      throw new SplitValidationError(`${type} split requires a value for every participant`);
    }
    if (!Number.isInteger(p.value)) {
      throw new SplitValidationError(`${type} split values must be integers`);
    }
    return p.value;
  });
}

/**
 * Validate that recorded payments cover the expense exactly. Multiple payers
 * are supported (three people chip in for one dinner bill).
 */
export function validatePayers(
  totalMinor: number,
  payers: { userId: string; amountMinor: number }[],
): void {
  if (payers.length === 0) {
    throw new SplitValidationError('An expense needs at least one payer');
  }
  const seen = new Set<string>();
  for (const p of payers) {
    if (seen.has(p.userId)) {
      throw new SplitValidationError(`Duplicate payer: ${p.userId}`);
    }
    seen.add(p.userId);
    if (!Number.isInteger(p.amountMinor) || p.amountMinor <= 0) {
      throw new SplitValidationError('Each payer must have paid a positive integer amount');
    }
  }
  const sum = payers.reduce((a, b) => a + b.amountMinor, 0);
  if (sum !== totalMinor) {
    throw new SplitValidationError(
      `Payments total ${sum} but the expense is ${totalMinor}`,
    );
  }
}
