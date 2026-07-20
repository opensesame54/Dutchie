import React from 'react';
import { View, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T, LedgerRow, EmptyState, LedgerSkeleton, useTheme } from '../components/ui';
import { spacing } from '../theme';
import { useFriends } from '../lib/queries';

export function FriendsScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const friends = useFriends();

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <FlatList
        data={friends.data ?? []}
        keyExtractor={(f) => f.id}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: insets.top + spacing.lg,
          paddingBottom: spacing.xxl * 3,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={friends.isRefetching}
            onRefresh={() => friends.refetch()}
            tintColor={c.ochre}
          />
        }
        ListHeaderComponent={
          <T variant="screenTitle" style={{ marginBottom: spacing.lg }}>Friends</T>
        }
        ListEmptyComponent={
          friends.isLoading ? (
            <LedgerSkeleton rows={4} />
          ) : (
            <EmptyState
              title="No friends yet"
              message="Add someone by email to split expenses one-to-one."
            />
          )
        }
        renderItem={({ item }) => {
          const entries = Object.entries(item.balances ?? {});
          const [currency, amount] = entries[0] ?? ['USD', 0];
          return (
            <LedgerRow
              label={item.name}
              sublabel={
                amount === 0
                  ? 'settled up'
                  : amount > 0
                    ? 'owes you'
                    : 'you owe'
              }
              amountMinor={Math.abs(amount)}
              currency={currency}
              tone={amount === 0 ? 'neutral' : amount > 0 ? 'positive' : 'negative'}
            />
          );
        }}
      />
    </View>
  );
}
