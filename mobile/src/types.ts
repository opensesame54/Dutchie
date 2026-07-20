export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  defaultCurrency: string;
}

export interface GroupMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: 'ADMIN' | 'MEMBER';
}

export interface Group {
  id: string;
  name: string;
  type: 'TRIP' | 'HOME' | 'COUPLE' | 'OTHER';
  avatarUrl: string | null;
  defaultCurrency: string;
  inviteCode: string;
  createdAt: string;
  members: GroupMember[];
}

export interface ExpensePayer {
  userId: string;
  amountMinor: number;
}

export interface ExpenseSplit {
  userId: string;
  owedAmountMinor: number;
  shareValue: number | null;
}

export interface Expense {
  id: string;
  groupId: string | null;
  description: string;
  amountMinor: number;
  currency: string;
  category: string;
  date: string;
  notes: string | null;
  receiptUrl: string | null;
  splitType: 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'SHARES';
  createdById: string;
  payers: ExpensePayer[];
  splits: ExpenseSplit[];
}

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
}

export interface GroupBalances {
  balancesByCurrency: Record<string, Record<string, number>>;
  debtsByCurrency: Record<string, Transfer[]>;
  simplifiedByCurrency: Record<string, Transfer[]>;
  members: { id: string; name: string; avatarUrl: string | null; leftAt: string | null }[];
}

export interface FriendBalance {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  balances: Record<string, number>;
  viaSharedExpenses?: boolean;
}

export interface BalanceSummary {
  totalsByCurrency: Record<string, { owed: number; owing: number; net: number }>;
  friends: FriendBalance[];
}

export interface ActivityEntry {
  id: string;
  groupId: string | null;
  actionType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string; avatarUrl: string | null };
  group: { id: string; name: string } | null;
}
