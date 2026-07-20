import React from 'react';
import { View, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDistanceToNow } from 'date-fns';
import {
  T, Card, LedgerRow, SectionHeading, EmptyState, LedgerSkeleton, useTheme, Divider,
} from '../components/ui';
import { spacing } from '../theme';
import { formatMoney } from '../lib/money';
import { useSummary, useActivity } from '../lib/queries';
import { useIsOnline } from '../lib/offline';
import { useAuth } from '../store/auth';
import type { ActivityEntry } from '../types';

export function DashboardScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const online = useIsOnline();
  const summary = useSummary();
  const activity = useActivity();

  const refreshing = summary.isRefetching || activity.isRefetching;
  const onRefresh = () => {
    summary.refetch();
    activity.refetch();
  };

  const totals = summary.data?.totalsByCurrency ?? {};
  const currencies = Object.keys(totals);
  // The headline figure uses the user's own currency when they have activity in
  // it, otherwise whichever currency they actually transact in.
  const primary = currencies.includes(user?.defaultCurrency ?? '')
    ? user!.defaultCurrency
    : currencies[0];
  const headline = primary ? totals[primary] : null;

  return (
    <ScrollView
      style={{ backgroundColor: c.paper }}
      contentContainerStyle={{
        padding: spacing.lg,
        paddingTop: insets.top + spacing.lg,
        // Clear the tab bar and the FAB above it.
        paddingBottom: spacing.xxl * 3,
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.ochre} />
      }
    >
      <T variant="screenTitle">Hey {user?.name.split(' ')[0]}</T>

      {/* Say the numbers are stale rather than letting them look wrong. An
          unexplained old balance reads as a bug; a labelled one reads as a
          network problem, which is what it is. */}
      {!online ? (
        <View style={[styles.offlineBanner, { borderColor: c.rule, backgroundColor: c.ochreSoft }]}>
          <T variant="caption" color={c.inkSoft}>
            Offline — showing your last known balances
          </T>
        </View>
      ) : null}

      <Card style={{ marginTop: spacing.lg }}>
        {summary.isLoading ? (
          <LedgerSkeleton rows={2} />
        ) : !headline ? (
          <View>
            <T variant="caption" color={c.inkFaint}>ALL SETTLED</T>
            <T variant="amountLarge" style={{ marginTop: spacing.xs }}>
              {formatMoney(0, user?.defaultCurrency ?? 'USD')}
            </T>
            <T variant="body" color={c.inkSoft} style={{ marginTop: spacing.xs }}>
              Nothing outstanding. Add an expense to get started.
            </T>
          </View>
        ) : (
          <View>
            <T variant="caption" color={c.inkFaint}>
              {headline.net >= 0 ? 'YOU ARE OWED' : 'YOU OWE'}
            </T>
            <T
              variant="amountLarge"
              color={headline.net >= 0 ? c.positive : c.negative}
              style={{ marginTop: spacing.xs }}
            >
              {formatMoney(Math.abs(headline.net), primary)}
            </T>

            <Divider />

            <View style={styles.splitRow}>
              <View>
                <T variant="caption" color={c.inkFaint}>OWED TO YOU</T>
                <T variant="amount" color={c.positive}>
                  {formatMoney(headline.owed, primary)}
                </T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T variant="caption" color={c.inkFaint}>YOU OWE</T>
                <T variant="amount" color={c.negative}>
                  {formatMoney(headline.owing, primary)}
                </T>
              </View>
            </View>

            {currencies.length > 1 ? (
              <T variant="caption" color={c.inkFaint} style={{ marginTop: spacing.md }}>
                Plus balances in {currencies.filter((x) => x !== primary).join(', ')}
              </T>
            ) : null}
          </View>
        )}
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <SectionHeading>Balances by person</SectionHeading>
        {summary.isLoading ? (
          <LedgerSkeleton rows={3} />
        ) : (summary.data?.friends.length ?? 0) === 0 ? (
          <T variant="body" color={c.inkFaint}>No shared expenses yet.</T>
        ) : (
          summary.data!.friends.map((f) => {
            const [currency, amount] = Object.entries(f.balances)[0] ?? ['USD', 0];
            return (
              <LedgerRow
                key={f.id}
                label={f.name}
                sublabel={amount === 0 ? 'settled up' : amount > 0 ? 'owes you' : 'you owe'}
                amountMinor={Math.abs(amount)}
                currency={currency}
                tone={amount === 0 ? 'neutral' : amount > 0 ? 'positive' : 'negative'}
              />
            );
          })
        )}
      </View>

      <View style={{ marginTop: spacing.xl }}>
        <SectionHeading>Recent activity</SectionHeading>
        {activity.isLoading ? (
          <LedgerSkeleton rows={4} />
        ) : (activity.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="Nothing here yet"
            message="Expenses and payments will show up as they happen."
          />
        ) : (
          activity.data!.slice(0, 12).map((entry) => (
            <ActivityRow key={entry.id} entry={entry} />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const c = useTheme();
  const meta = entry.metadata ?? {};
  const description = typeof meta.description === 'string' ? meta.description : null;
  const amountMinor = typeof meta.amountMinor === 'number' ? meta.amountMinor : undefined;
  const currency = typeof meta.currency === 'string' ? meta.currency : undefined;

  const verb: Record<string, string> = {
    EXPENSE_CREATED: 'added',
    EXPENSE_UPDATED: 'edited',
    EXPENSE_DELETED: 'deleted',
    SETTLEMENT_CREATED: 'recorded a payment',
    SETTLEMENT_DELETED: 'undid a payment',
    MEMBER_JOINED: 'joined',
    MEMBER_LEFT: 'left',
    MEMBER_REMOVED: 'was removed',
    GROUP_CREATED: 'created the group',
    GROUP_UPDATED: 'updated the group',
    COMMENT_ADDED: 'commented on',
  };

  const label = description
    ? `${entry.user.name.split(' ')[0]} ${verb[entry.actionType] ?? 'updated'} ${description}`
    : `${entry.user.name.split(' ')[0]} ${verb[entry.actionType] ?? 'updated'}`;

  return (
    <LedgerRow
      label={label}
      sublabel={[
        entry.group?.name,
        formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true }),
      ]
        .filter(Boolean)
        .join(' · ')}
      right={
        amountMinor !== undefined && currency ? (
          <T variant="amount" color={c.inkSoft}>
            {formatMoney(amountMinor, currency)}
          </T>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  offlineBanner: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
});
