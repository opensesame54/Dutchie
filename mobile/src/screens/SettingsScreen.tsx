import React from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T, Card, LedgerRow, SectionHeading, Button, useTheme } from '../components/ui';
import { spacing } from '../theme';
import { useAuth } from '../store/auth';
import { API_BASE_URL } from '../lib/api';

export function SettingsScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  return (
    <ScrollView
      style={{ backgroundColor: c.paper }}
      contentContainerStyle={{
        padding: spacing.lg,
        paddingTop: insets.top + spacing.lg,
        paddingBottom: spacing.xxl * 3,
      }}
    >
      <T variant="screenTitle" style={{ marginBottom: spacing.lg }}>Settings</T>

      <Card>
        <T variant="bodyStrong">{user?.name}</T>
        <T variant="body" color={c.inkSoft} style={{ marginTop: spacing.xs }}>
          {user?.email}
        </T>
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <SectionHeading>Preferences</SectionHeading>
        <LedgerRow
          label="Default currency"
          right={<T variant="amount">{user?.defaultCurrency}</T>}
        />
      </View>

      <View style={{ marginTop: spacing.xl }}>
        <SectionHeading>About</SectionHeading>
        <LedgerRow
          label="API"
          right={<T variant="caption" color={c.inkFaint}>{API_BASE_URL}</T>}
        />
        <LedgerRow
          label="Version"
          right={<T variant="caption" color={c.inkFaint}>1.0.0</T>}
        />
      </View>

      <View style={{ marginTop: spacing.xxl }}>
        <Button title="Log out" variant="danger" onPress={() => logout()} />
      </View>
    </ScrollView>
  );
}
