import React, { useMemo, useState } from 'react';
import { View, ScrollView, RefreshControl, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import {
  T, Card, LedgerRow, SectionHeading, EmptyState, LedgerSkeleton, Button,
  useTheme, Fab, Divider,
} from '../components/ui';
import { spacing } from '../theme';
import { formatMoney, formatMinor } from '../lib/money';
import { useGroup, useGroupBalances, useExpenses, useSettleUp } from '../lib/queries';
import { useAuth } from '../store/auth';
import type { RootStackParamList } from '../navigation';
import type { Transfer } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupDetail'>;

type Tab = 'expenses' | 'balances';

export function GroupDetailScreen({ route, navigation }: Props) {
  const { groupId } = route.params;
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user);

  const [tab, setTab] = useState<Tab>('expenses');
  const [settling, setSettling] = useState<Transfer | null>(null);

  const group = useGroup(groupId);
  const balances = useGroupBalances(groupId);
  const expenses = useExpenses({ groupId });

  const nameOf = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of balances.data?.members ?? []) map[m.id] = m.name;
    for (const m of group.data?.members ?? []) map[m.id] = m.name;
    return map;
  }, [balances.data, group.data]);

  const currency = group.data?.defaultCurrency ?? 'USD';
  const net = balances.data?.balancesByCurrency[currency] ?? {};
  const simplified = balances.data?.simplifiedByCurrency[currency] ?? [];
  const pairwise = balances.data?.debtsByCurrency[currency] ?? [];

  const myNet = me ? net[me.id] ?? 0 : 0;

  const refreshing =
    group.isRefetching || balances.isRefetching || expenses.isRefetching;

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing.xxl * 3,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              group.refetch();
              balances.refetch();
              expenses.refetch();
            }}
            tintColor={c.ochre}
          />
        }
      >
        <Card>
          <T variant="caption" color={c.inkFaint}>
            {myNet === 0 ? 'YOU ARE SETTLED UP' : myNet > 0 ? 'YOU ARE OWED' : 'YOU OWE'}
          </T>
          <T
            variant="amountLarge"
            color={myNet === 0 ? c.ink : myNet > 0 ? c.positive : c.negative}
            style={{ marginTop: spacing.xs }}
          >
            {formatMoney(Math.abs(myNet), currency)}
          </T>
        </Card>

        <View style={styles.tabs}>
          {(['expenses', 'balances'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t }}
              style={[
                styles.tab,
                { borderBottomColor: tab === t ? c.ochre : 'transparent' },
              ]}
            >
              <T
                variant="bodyStrong"
                color={tab === t ? c.ink : c.inkFaint}
                style={{ textTransform: 'capitalize' }}
              >
                {t}
              </T>
            </Pressable>
          ))}
        </View>

        {tab === 'expenses' ? (
          expenses.isLoading ? (
            <LedgerSkeleton rows={5} />
          ) : (expenses.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="No expenses yet"
              message="Tap + to add the first one."
            />
          ) : (
            expenses.data!.map((e) => {
              const myShare = e.splits.find((s) => s.userId === me?.id)?.owedAmountMinor ?? 0;
              const iPaid = e.payers.reduce(
                (a, p) => a + (p.userId === me?.id ? p.amountMinor : 0),
                0,
              );
              const delta = iPaid - myShare;
              const payerNames = e.payers
                .map((p) => (p.userId === me?.id ? 'You' : nameOf[p.userId]?.split(' ')[0]))
                .filter(Boolean)
                .join(' & ');

              return (
                <LedgerRow
                  key={e.id}
                  label={e.description}
                  sublabel={`${payerNames} paid ${formatMoney(e.amountMinor, e.currency)} · ${format(new Date(e.date), 'd MMM')}`}
                  amountMinor={Math.abs(delta)}
                  currency={e.currency}
                  tone={delta === 0 ? 'neutral' : delta > 0 ? 'positive' : 'negative'}
                />
              );
            })
          )
        ) : balances.isLoading ? (
          <LedgerSkeleton rows={4} />
        ) : (
          <View>
            <SectionHeading>Where everyone stands</SectionHeading>
            {Object.keys(net).length === 0 ? (
              <EmptyState title="All square" message="Nobody owes anybody anything." />
            ) : (
              Object.entries(net).map(([userId, amount]) => (
                <LedgerRow
                  key={userId}
                  label={userId === me?.id ? 'You' : nameOf[userId] ?? 'Someone'}
                  sublabel={amount > 0 ? 'is owed' : 'owes'}
                  amountMinor={Math.abs(amount)}
                  currency={currency}
                  tone={amount > 0 ? 'positive' : 'negative'}
                />
              ))
            )}

            {simplified.length > 0 ? (
              <View style={{ marginTop: spacing.xl }}>
                <SectionHeading>Simplest way to settle</SectionHeading>
                <Card>
                  <T variant="caption" color={c.inkSoft} style={{ marginBottom: spacing.md }}>
                    {pairwise.length > simplified.length
                      ? `${simplified.length} payments instead of ${pairwise.length}.`
                      : `${simplified.length} payment${simplified.length === 1 ? '' : 's'} clears everything.`}
                  </T>
                  <Divider />
                  {simplified.map((t, i) => {
                    const involvesMe = t.fromUserId === me?.id || t.toUserId === me?.id;
                    return (
                      <LedgerRow
                        key={`${t.fromUserId}-${t.toUserId}-${i}`}
                        label={`${t.fromUserId === me?.id ? 'You' : nameOf[t.fromUserId]?.split(' ')[0] ?? '?'} → ${t.toUserId === me?.id ? 'you' : nameOf[t.toUserId]?.split(' ')[0] ?? '?'}`}
                        sublabel={involvesMe ? 'tap to record this payment' : undefined}
                        amountMinor={t.amountMinor}
                        currency={currency}
                        onPress={involvesMe ? () => setSettling(t) : undefined}
                      />
                    );
                  })}
                </Card>
              </View>
            ) : null}

            <View style={{ marginTop: spacing.xl }}>
              <SectionHeading>Members</SectionHeading>
              {(group.data?.members ?? []).map((m) => (
                <LedgerRow
                  key={m.id}
                  label={m.id === me?.id ? `${m.name} (you)` : m.name}
                  sublabel={m.role === 'ADMIN' ? 'admin' : undefined}
                  right={<T variant="caption" color={c.inkFaint}>{m.email}</T>}
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <Fab
        onPress={() =>
          navigation.navigate('AddExpense', { groupId, currency })
        }
      />

      <SettleSheet
        transfer={settling}
        groupId={groupId}
        currency={currency}
        nameOf={nameOf}
        onClose={() => setSettling(null)}
      />
    </View>
  );
}

function SettleSheet({
  transfer, groupId, currency, nameOf, onClose,
}: {
  transfer: Transfer | null;
  groupId: string;
  currency: string;
  nameOf: Record<string, string>;
  onClose: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const settle = useSettleUp();
  const me = useAuth((s) => s.user);
  const [error, setError] = useState<string | null>(null);

  if (!transfer) return null;

  const outgoing = transfer.fromUserId === me?.id;
  const otherId = outgoing ? transfer.toUserId : transfer.fromUserId;

  async function record(method: 'CASH' | 'BANK' | 'OTHER') {
    setError(null);
    try {
      await settle.mutateAsync({
        groupId,
        fromUserId: transfer!.fromUserId,
        toUserId: transfer!.toUserId,
        amount: formatMinor(transfer!.amountMinor, currency),
        currency,
        method,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the payment');
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
      <View
        style={[
          styles.bottomSheet,
          { backgroundColor: c.paper, paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: c.rule }]} />

        <T variant="screenTitle" style={{ marginBottom: spacing.sm }}>
          {outgoing ? 'Record payment' : 'Mark as received'}
        </T>
        <T variant="body" color={c.inkSoft} style={{ marginBottom: spacing.lg }}>
          {outgoing
            ? `You pay ${nameOf[otherId] ?? 'them'}`
            : `${nameOf[otherId] ?? 'They'} paid you`}
        </T>

        <T variant="amountLarge" style={{ marginBottom: spacing.xl }}>
          {formatMoney(transfer.amountMinor, currency)}
        </T>

        {error ? (
          <T variant="caption" color={c.negative} style={{ marginBottom: spacing.md }}>
            {error}
          </T>
        ) : null}

        <Button title="Cash" onPress={() => record('CASH')} loading={settle.isPending} />
        <View style={{ height: spacing.sm }} />
        <Button title="Bank transfer" variant="secondary" onPress={() => record('BANK')} />
        <View style={{ height: spacing.sm }} />
        <Button title="Cancel" variant="secondary" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    gap: spacing.lg,
  },
  tab: {
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    minHeight: 48,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
});
