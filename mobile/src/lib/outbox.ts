import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';
import { request, ApiError } from './api';
import type { CreateExpenseInput } from './queries';

/**
 * Outbox for expenses created while offline.
 *
 * Deliberately explicit rather than relying on React Query's mutation replay:
 * a queued expense is money, so the user needs to see that it is pending, and
 * a failed replay must not silently vanish or silently double-post.
 *
 * Each entry carries a client-generated id used as an idempotency key, so a
 * flush interrupted mid-request cannot create the same expense twice when it
 * retries.
 */

const OUTBOX_KEY = 'dutchie.outbox';
const MAX_ATTEMPTS = 5;

export interface OutboxEntry {
  id: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  payload: CreateExpenseInput;
}

type Listener = (entries: OutboxEntry[]) => void;
const listeners = new Set<Listener>();

function notify(entries: OutboxEntry[]) {
  for (const l of listeners) l(entries);
}

export function subscribeToOutbox(listener: Listener): () => void {
  listeners.add(listener);
  void readOutbox().then(listener);
  return () => listeners.delete(listener);
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    // A corrupt outbox must not brick the app on launch.
    return [];
  }
}

async function writeOutbox(entries: OutboxEntry[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
  notify(entries);
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueExpense(payload: CreateExpenseInput): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    id: makeId(),
    createdAt: Date.now(),
    attempts: 0,
    payload,
  };
  const entries = await readOutbox();
  await writeOutbox([...entries, entry]);
  return entry;
}

export async function removeFromOutbox(id: string): Promise<void> {
  const entries = await readOutbox();
  await writeOutbox(entries.filter((e) => e.id !== id));
}

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
}

let flushing = false;

/**
 * Attempt to send everything queued. Safe to call repeatedly; a second call
 * while a flush is in flight returns immediately rather than double-posting.
 */
export async function flushOutbox(): Promise<FlushResult> {
  if (flushing || !onlineManager.isOnline()) {
    const remaining = (await readOutbox()).length;
    return { sent: 0, failed: 0, remaining };
  }

  flushing = true;
  let sent = 0;
  let failed = 0;

  try {
    const entries = await readOutbox();
    const survivors: OutboxEntry[] = [];

    for (const entry of entries) {
      try {
        await request('/expenses', {
          method: 'POST',
          // The client id lets the server collapse a retry of the same expense.
          body: { ...entry.payload, clientRequestId: entry.id },
        });
        sent += 1;
      } catch (err) {
        const attempts = entry.attempts + 1;

        // A 4xx will never succeed on retry — the payload itself is wrong, so
        // keep it visible for the user to fix or discard rather than looping.
        const permanent =
          err instanceof ApiError && err.status >= 400 && err.status < 500;

        if (permanent || attempts >= MAX_ATTEMPTS) {
          failed += 1;
          survivors.push({
            ...entry,
            attempts,
            lastError: err instanceof Error ? err.message : 'Could not sync',
          });
        } else {
          survivors.push({ ...entry, attempts });
        }

        // Stop on the first connectivity failure; the rest will fail too.
        if (err instanceof ApiError && err.status === 0) {
          survivors.push(...entries.slice(entries.indexOf(entry) + 1));
          break;
        }
      }
    }

    await writeOutbox(survivors);
    return { sent, failed, remaining: survivors.length };
  } finally {
    flushing = false;
  }
}

/** Flush whenever connectivity returns. Returns an unsubscribe function. */
export function startOutboxSync(onFlushed?: (result: FlushResult) => void): () => void {
  return onlineManager.subscribe((online) => {
    if (!online) return;
    void flushOutbox().then((result) => {
      if (result.sent > 0 || result.failed > 0) onFlushed?.(result);
    });
  });
}
