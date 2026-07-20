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
    onSuccess: (_data, input) => {
      // Anything that shows a number derived from this expense must refetch.
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: keys.summary });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: keys.friends });
      if (input.groupId) {
        qc.invalidateQueries({ queryKey: keys.groupBalances(input.groupId) });
      }
    },
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
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
