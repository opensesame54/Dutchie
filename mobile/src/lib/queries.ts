import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from './api';
import type {
  Group, Expense, GroupBalances, BalanceSummary, ActivityEntry, FriendBalance,
} from '../types';

/**
 * Query keys are centralised so an invalidation after a mutation cannot miss a
 * screen — a stale balance after adding an expense is the bug users notice
 * fastest.
 */
export const keys = {
  groups: ['groups'] as const,
  group: (id: string) => ['groups', id] as const,
  groupBalances: (id: string) => ['balances', 'group', id] as const,
  summary: ['balances', 'summary'] as const,
  expenses: (params: Record<string, string | undefined>) => ['expenses', params] as const,
  activity: (groupId?: string) => ['activity', groupId ?? 'all'] as const,
  friends: ['friends'] as const,
};

export function useGroups() {
  return useQuery({
    queryKey: keys.groups,
    queryFn: () => request<{ groups: Group[] }>('/groups').then((r) => r.groups),
  });
}

export function useGroup(id: string) {
  return useQuery({
    queryKey: keys.group(id),
    queryFn: () => request<{ group: Group }>(`/groups/${id}`).then((r) => r.group),
  });
}

export function useGroupBalances(id: string) {
  return useQuery({
    queryKey: keys.groupBalances(id),
    queryFn: () => request<GroupBalances>(`/balances/groups/${id}`),
  });
}

export function useSummary() {
  return useQuery({
    queryKey: keys.summary,
    queryFn: () => request<BalanceSummary>('/balances/summary'),
  });
}

export function useFriends() {
  return useQuery({
    queryKey: keys.friends,
    queryFn: () => request<{ friends: FriendBalance[] }>('/friends').then((r) => r.friends),
  });
}

export function useExpenses(params: { groupId?: string; friendId?: string; search?: string }) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => !!v) as [string, string][],
  ).toString();

  return useQuery({
    queryKey: keys.expenses(params),
    queryFn: () =>
      request<{ expenses: Expense[] }>(`/expenses${query ? `?${query}` : ''}`).then(
        (r) => r.expenses,
      ),
  });
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: ['expenses', 'detail', id],
    enabled: !!id,
    queryFn: () => request<{ expense: Expense }>(`/expenses/${id}`).then((r) => r.expense),
  });
}

export function useActivity(groupId?: string) {
  return useQuery({
    queryKey: keys.activity(groupId),
    queryFn: () =>
      request<{ activity: ActivityEntry[] }>(
        `/activity${groupId ? `?groupId=${groupId}` : ''}`,
      ).then((r) => r.activity),
  });
}

export interface CreateExpenseInput {
  groupId: string | null;
  description: string;
  amount: string;
  currency: string;
  category: string;
  splitType: 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'SHARES';
  payers: { userId: string; amount: string }[];
  participants: { userId: string; value?: number }[];
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseInput) =>
      request<{ expense: Expense }>('/expenses', { method: 'POST', body: input }),

    // Optimistic insert: the expense appears in the list immediately, and the
    // snapshot taken here is what we roll back to if the request fails.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['expenses'] });

      const previous = qc.getQueriesData<Expense[]>({ queryKey: ['expenses'] });
      const optimistic = buildOptimisticExpense(input);

      qc.setQueriesData<Expense[]>({ queryKey: ['expenses'] }, (old) =>
        old ? [optimistic, ...old] : [optimistic],
      );

      return { previous, optimisticId: optimistic.id };
    },

    onError: (_err, _input, context) => {
      // Put every touched cache back exactly as it was. Leaving a phantom
      // expense on screen after a failure is worse than never showing it.
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
    },

    onSuccess: (data, input, context) => {
      // Swap the placeholder for the server's version, which carries the real
      // id and the authoritative split amounts.
      qc.setQueriesData<Expense[]>({ queryKey: ['expenses'] }, (old) =>
        old?.map((e) => (e.id === context?.optimisticId ? data.expense : e)),
      );

      qc.invalidateQueries({ queryKey: keys.summary });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: keys.friends });
      if (input.groupId) {
        qc.invalidateQueries({ queryKey: keys.groupBalances(input.groupId) });
      }
    },

    onSettled: () => {
      // Balances are computed server-side; never trust a locally-derived total.
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}

/**
 * A stand-in expense for the optimistic window.
 *
 * The split amounts here are a PREVIEW only — the server owns allocation, and
 * onSuccess replaces this object wholesale. It exists so the row appears
 * instantly, not so the client can do money maths.
 */
function buildOptimisticExpense(input: CreateExpenseInput): Expense {
  const amountMinor = Math.round(Number(input.amount) * 100) || 0;
  const count = input.participants.length || 1;
  const base = Math.floor(amountMinor / count);
  let leftover = amountMinor - base * count;

  return {
    id: `optimistic-${Date.now()}`,
    groupId: input.groupId,
    description: input.description,
    amountMinor,
    currency: input.currency,
    category: input.category,
    date: new Date().toISOString(),
    notes: null,
    receiptUrl: null,
    splitType: input.splitType,
    createdById: input.payers[0]?.userId ?? '',
    payers: input.payers.map((p) => ({
      userId: p.userId,
      amountMinor: Math.round(Number(p.amount) * 100) || 0,
    })),
    splits: input.participants.map((p) => {
      const extra = leftover > 0 ? 1 : 0;
      leftover -= extra;
      return { userId: p.userId, owedAmountMinor: base + extra, shareValue: p.value ?? null };
    }),
  };
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: CreateExpenseInput & { id: string }) =>
      request<{ expense: Expense }>(`/expenses/${id}`, { method: 'PUT', body: input }),

    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['expenses'] });
      const previous = qc.getQueriesData<Expense[]>({ queryKey: ['expenses'] });

      qc.setQueriesData<Expense[]>({ queryKey: ['expenses'] }, (old) =>
        old?.map((e) =>
          e.id === input.id
            ? { ...e, description: input.description, category: input.category }
            : e,
        ),
      );

      return { previous };
    },

    onError: (_err, _input, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
    },

    onSettled: (_data, _err, input) => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['balances'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      if (input.groupId) qc.invalidateQueries({ queryKey: keys.groupBalances(input.groupId) });
    },
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/expenses/${id}`, { method: 'DELETE' }),

    // Optimistic removal, so the row disappears on tap rather than after a
    // round trip — with the snapshot kept to restore it if the delete fails.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['expenses'] });
      const previous = qc.getQueriesData<Expense[]>({ queryKey: ['expenses'] });

      qc.setQueriesData<Expense[]>({ queryKey: ['expenses'] }, (old) =>
        old?.filter((e) => e.id !== id),
      );

      return { previous };
    },

    onError: (_err, _id, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['balances'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export interface SettleInput {
  groupId: string | null;
  fromUserId: string;
  toUserId: string;
  amount: string;
  currency: string;
  method: 'CASH' | 'VENMO' | 'BANK' | 'OTHER';
}

export function useSettleUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SettleInput) =>
      request('/settlements', { method: 'POST', body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balances'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: keys.friends });
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; type: string; memberEmails?: string[] }) =>
      request<{ group: Group; invitesNotFound: string[] }>('/groups', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.groups }),
  });
}
