import React, { useState } from 'react';
import { View, FlatList, RefreshControl, Modal, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  T, LedgerRow, EmptyState, LedgerSkeleton, Button, Field, Card, useTheme, Fab,
} from '../components/ui';
import { spacing } from '../theme';
import { useGroups, useCreateGroup } from '../lib/queries';
import type { RootStackParamList } from '../navigation';
import type { Group } from '../types';

const GROUP_EMOJI: Record<Group['type'], string> = {
  TRIP: '🧳',
  HOME: '🏠',
  COUPLE: '💞',
  OTHER: '🧾',
};

type Props = NativeStackScreenProps<RootStackParamList, 'Tabs'>;

export function GroupsScreen({ navigation }: { navigation: Props['navigation'] }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const groups = useGroups();
  const [creating, setCreating] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <FlatList
        data={groups.data ?? []}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: insets.top + spacing.lg,
          paddingBottom: spacing.xxl * 3,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={groups.isRefetching}
            onRefresh={() => groups.refetch()}
            tintColor={c.ochre}
          />
        }
        ListHeaderComponent={
          <T variant="screenTitle" style={{ marginBottom: spacing.lg }}>Groups</T>
        }
        ListEmptyComponent={
          groups.isLoading ? (
            <LedgerSkeleton rows={4} />
          ) : (
            <EmptyState
              title="No groups yet"
              message="Create one for a trip, a flat, or anything you split regularly."
              action={<Button title="New group" onPress={() => setCreating(true)} />}
            />
          )
        }
        renderItem={({ item }) => (
          <LedgerRow
            label={`${GROUP_EMOJI[item.type]}  ${item.name}`}
            sublabel={`${item.members.length} ${item.members.length === 1 ? 'person' : 'people'}`}
            onPress={() =>
              navigation.navigate('GroupDetail', { groupId: item.id, name: item.name })
            }
            right={<T variant="caption" color={c.inkFaint}>›</T>}
          />
        )}
      />

      <Fab onPress={() => setCreating(true)} />

      <CreateGroupSheet visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}

function CreateGroupSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const createGroup = useCreateGroup();

  const [name, setName] = useState('');
  const [type, setType] = useState<Group['type']>('TRIP');
  const [emails, setEmails] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setType('TRIP');
    setEmails('');
    setError(null);
  }

  async function submit() {
    if (!name.trim()) {
      setError('Give the group a name');
      return;
    }
    setError(null);
    try {
      const memberEmails = emails
        .split(/[,\s]+/)
        .map((e) => e.trim())
        .filter((e) => e.includes('@'));

      const result = await createGroup.mutateAsync({ name: name.trim(), type, memberEmails });

      // Silently dropping unknown invitees would leave the user thinking
      // someone was added when they were not.
      if (result.invitesNotFound.length > 0) {
        setError(`Not on Dutchie yet: ${result.invitesNotFound.join(', ')}`);
        setTimeout(() => { reset(); onClose(); }, 2200);
        return;
      }

      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the group');
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      // Android hardware back must close the sheet, not exit the app.
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.sheet,
          { backgroundColor: c.paper, paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
        ]}
      >
        <T variant="screenTitle" style={{ marginBottom: spacing.xl }}>New group</T>

        <Field label="Name" value={name} onChangeText={setName} placeholder="Lisbon Trip" autoFocus />

        <T variant="caption" color={c.inkSoft} style={{ marginBottom: spacing.sm }}>Type</T>
        <View style={styles.chips}>
          {(['TRIP', 'HOME', 'COUPLE', 'OTHER'] as const).map((t) => (
            <Button
              key={t}
              title={`${GROUP_EMOJI[t]} ${t[0]}${t.slice(1).toLowerCase()}`}
              variant={type === t ? 'primary' : 'secondary'}
              onPress={() => setType(t)}
              style={{ flexGrow: 1, minWidth: '45%' }}
            />
          ))}
        </View>

        <View style={{ height: spacing.lg }} />

        <Field
          label="Invite by email (optional)"
          value={emails}
          onChangeText={setEmails}
          placeholder="ben@example.com, chloe@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />

        {error ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <T variant="caption" color={c.negative}>{error}</T>
          </Card>
        ) : null}

        <View style={{ flex: 1 }} />

        <Button title="Create group" onPress={submit} loading={createGroup.isPending} />
        <View style={{ height: spacing.sm }} />
        <Button title="Cancel" variant="secondary" onPress={() => { reset(); onClose(); }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
