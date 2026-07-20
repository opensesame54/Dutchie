import React, { useEffect } from 'react';
import { View, FlatList, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { T, LedgerRow, EmptyState, LedgerSkeleton, useTheme } from '../components/ui';
import { spacing } from '../theme';
import { request } from '../lib/api';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      request<{ notifications: NotificationRow[]; unreadCount: number }>('/notifications'),
  });
}

export function NotificationsScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const notifications = useNotifications();

  const markRead = useMutation({
    mutationFn: () => request('/notifications/read', { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Opening the screen is the read receipt. Only fire when something is
  // actually unread, so revisiting does not spam the endpoint.
  useEffect(() => {
    if ((notifications.data?.unreadCount ?? 0) > 0 && !markRead.isPending) {
      markRead.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.data?.unreadCount]);

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <FlatList
        data={notifications.data?.notifications ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: insets.top + spacing.lg,
          paddingBottom: spacing.xxl * 3,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={notifications.isRefetching}
            onRefresh={() => notifications.refetch()}
            tintColor={c.ochre}
          />
        }
        ListHeaderComponent={
          <T variant="screenTitle" style={{ marginBottom: spacing.lg }}>Notifications</T>
        }
        ListEmptyComponent={
          notifications.isLoading ? (
            <LedgerSkeleton rows={4} />
          ) : (
            <EmptyState
              title="Nothing yet"
              message="You'll hear about new expenses, payments, and group invites here."
            />
          )
        }
        renderItem={({ item }) => (
          <LedgerRow
            label={item.title}
            sublabel={`${item.body} · ${formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}`}
            right={
              // An unread marker, since the list marks everything read on open.
              !item.readAt ? (
                <View
                  style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.ochre }}
                  accessibilityLabel="Unread"
                />
              ) : undefined
            }
          />
        )}
      />
    </View>
  );
}
