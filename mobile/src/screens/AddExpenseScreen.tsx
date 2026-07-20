import React, { useEffect, useMemo, useState } from 'react';
import {
  View, ScrollView, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  T, Field, Button, Card, SectionHeading, useTheme, LedgerRow, Divider,
} from '../components/ui';
import { spacing, radius, MIN_TOUCH_TARGET } from '../theme';
import { parseToMinor, formatMinor, formatMoney } from '../lib/money';
import { useGroup, useCreateExpense } from '../lib/queries';
import { useAuth } from '../store/auth';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'AddExpense'>;

type SplitType = 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'SHARES';

const CATEGORIES = [
  'general', 'food', 'groceries', 'transport', 'lodging',
  'utilities', 'rent', 'entertainment', 'activities',
];

export function AddExpenseScreen({ route, navigation }: Props) {
  const { groupId, currency } = route.params;
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user);
  const group = useGroup(groupId);
  const createExpense = useCreateExpense();

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('general');
  const [splitType, setSplitType] = useState<SplitType>('EQUAL');
  const [paidById, setPaidById] = useState<string | undefined>(me?.id);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  /** Raw per-person input for EXACT / PERCENTAGE / SHARES. */
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const members = group.data?.members ?? [];

  // Default to splitting with everyone once the group loads.
  useEffect(() => {
    if (members.length > 0 && Object.keys(selected).length === 0) {
      setSelected(Object.fromEntries(members.map((m) => [m.id, true])));
    }
  }, [members.length]);

  const participants = members.filter((m) => selected[m.id]);
  const totalMinor = parseToMinor(amount, currency);

  /**
   * Live preview of what each person will owe. This mirrors the server's
   * allocation, but the server remains authoritative — the preview is only ever
   * shown, never submitted as the computed result.
   */
  const preview = useMemo(() => {
    if (!totalMinor || participants.length === 0) return null;

    if (splitType === 'EQUAL') {
      const base = Math.floor(totalMinor / participants.length);
      let leftover = totalMinor - base * participants.length;
      return participants.map((p) => {
        const extra = leftover > 0 ? 1 : 0;
        leftover -= extra;
        return { userId: p.id, amount: base + extra };
      });
    }

    if (splitType === 'EXACT') {
      return participants.map((p) => ({
        userId: p.id,
        amount: parseToMinor(values[p.id] ?? '', currency) ?? 0,
      }));
    }

    const weights = participants.map((p) => Number(values[p.id] ?? '0') || 0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return null;

    const base = participants.map((_, i) => Math.floor((totalMinor * weights[i]) / totalWeight));
    let leftover = totalMinor - base.reduce((a, b) => a + b, 0);
    const order = base
      .map((_, i) => ({ i, rem: totalMinor * weights[i] - base[i] * totalWeight }))
      .sort((a, b) => b.rem - a.rem || a.i - b.i);
    for (const { i } of order) {
      if (leftover <= 0) break;
      if (weights[i] === 0) continue;
      base[i] += 1;
      leftover -= 1;
    }
    return participants.map((p, i) => ({ userId: p.id, amount: base[i] }));
  }, [totalMinor, participants, splitType, values, currency]);

  const previewSum = preview?.reduce((a, p) => a + p.amount, 0) ?? 0;
  const exactMismatch =
    splitType === 'EXACT' && totalMinor !== null && previewSum !== totalMinor;

  async function submit() {
    setError(null);

    if (!description.trim()) return setError('What was this for?');
    if (totalMinor === null || totalMinor <= 0) return setError('Enter a valid amount');
    if (!paidById) return setError('Who paid?');
    if (participants.length === 0) return setError('Split between at least one person');
    if (exactMismatch) {
      return setError(
        `Exact amounts add up to ${formatMoney(previewSum, currency)}, not ${formatMoney(totalMinor, currency)}`,
      );
    }

    try {
      await createExpense.mutateAsync({
        groupId,
        description: description.trim(),
        amount: formatMinor(totalMinor, currency),
        currency,
        category,
        splitType,
        payers: [{ userId: paidById, amount: formatMinor(totalMinor, currency) }],
        participants: participants.map((p) => ({
          userId: p.id,
          value:
            splitType === 'EQUAL'
              ? undefined
              : splitType === 'EXACT'
                ? parseToMinor(values[p.id] ?? '', currency) ?? 0
                : splitType === 'PERCENTAGE'
                  ? Math.round((Number(values[p.id] ?? '0') || 0) * 100)
                  : Number(values[p.id] ?? '0') || 0,
        })),
      });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the expense');
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Dinner at Time Out Market"
          autoFocus
        />

        <Field
          label={`Amount (${currency})`}
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          keyboardType="decimal-pad"
          mono
          error={
            amount.length > 0 && totalMinor === null
              ? `Enter a valid ${currency} amount`
              : undefined
          }
        />

        <SectionHeading>Category</SectionHeading>
        <View style={styles.chips}>
          {CATEGORIES.map((cat) => (
            <Chip
              key={cat}
              label={cat}
              active={category === cat}
              onPress={() => setCategory(cat)}
            />
          ))}
        </View>

        <View style={{ height: spacing.xl }} />

        <SectionHeading>Who paid</SectionHeading>
        <View style={styles.chips}>
          {members.map((m) => (
            <Chip
              key={m.id}
              label={m.id === me?.id ? 'You' : m.name.split(' ')[0]}
              active={paidById === m.id}
              onPress={() => setPaidById(m.id)}
            />
          ))}
        </View>

        <View style={{ height: spacing.xl }} />

        <SectionHeading>Split</SectionHeading>
        <View style={styles.chips}>
          {(['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES'] as const).map((t) => (
            <Chip
              key={t}
              label={t === 'PERCENTAGE' ? '%' : t[0] + t.slice(1).toLowerCase()}
              active={splitType === t}
              onPress={() => setSplitType(t)}
            />
          ))}
        </View>

        <Card style={{ marginTop: spacing.md }}>
          {members.map((m) => {
            const isIn = !!selected[m.id];
            const owed = preview?.find((p) => p.userId === m.id)?.amount;

            return (
              <View key={m.id}>
                <Pressable
                  onPress={() => setSelected((s) => ({ ...s, [m.id]: !s[m.id] }))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isIn }}
                  style={styles.memberRow}
                >
                  <View style={[
                    styles.checkbox,
                    { borderColor: isIn ? c.ochre : c.rule, backgroundColor: isIn ? c.ochre : 'transparent' },
                  ]}>
                    {isIn ? <T variant="caption" color="#fff">✓</T> : null}
                  </View>

                  <T variant="body" style={{ flex: 1 }} color={isIn ? c.ink : c.inkFaint}>
                    {m.id === me?.id ? 'You' : m.name}
                  </T>

                  {isIn && splitType !== 'EQUAL' ? (
                    <SplitValueInput
                      value={values[m.id] ?? ''}
                      onChange={(v) => setValues((s) => ({ ...s, [m.id]: v }))}
                      suffix={splitType === 'PERCENTAGE' ? '%' : splitType === 'SHARES' ? 'sh' : currency}
                    />
                  ) : null}

                  {isIn && owed !== undefined ? (
                    <T variant="amount" color={c.inkSoft} style={{ marginLeft: spacing.sm, minWidth: 70, textAlign: 'right' }}>
                      {formatMoney(owed, currency)}
                    </T>
                  ) : null}
                </Pressable>
                <Divider />
              </View>
            );
          })}

          <View style={styles.totalRow}>
            <T variant="bodyStrong">Total split</T>
            <T
              variant="amount"
              color={exactMismatch ? c.negative : c.ink}
            >
              {formatMoney(previewSum, currency)}
            </T>
          </View>
        </Card>

        {error ? (
          <Card style={{ marginTop: spacing.lg }}>
            <T variant="caption" color={c.negative}>{error}</T>
          </Card>
        ) : null}

        <View style={{ height: spacing.xl }} />

        <Button
          title="Save expense"
          onPress={submit}
          loading={createExpense.isPending}
          disabled={!description.trim() || totalMinor === null}
        />
        <View style={{ height: spacing.sm }} />
        <Button title="Cancel" variant="secondary" onPress={() => navigation.goBack()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? c.ochre : c.paperRaised,
          borderColor: active ? c.ochre : c.rule,
        },
      ]}
    >
      <T variant="caption" color={active ? '#fff' : c.inkSoft} style={{ textTransform: 'capitalize' }}>
        {label}
      </T>
    </Pressable>
  );
}

function SplitValueInput({
  value, onChange, suffix,
}: {
  value: string;
  onChange: (v: string) => void;
  suffix: string;
}) {
  const c = useTheme();
  return (
    <View style={[styles.valueInput, { borderColor: c.rule, backgroundColor: c.paper }]}>
      <T variant="caption" color={c.inkFaint}>{suffix}</T>
      <View style={{ width: spacing.xs }} />
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={c.inkFaint}
        accessibilityLabel={`Split value in ${suffix}`}
        style={{ minWidth: 44, color: c.ink, fontSize: 15, padding: 0 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    gap: spacing.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    height: 36,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
});
