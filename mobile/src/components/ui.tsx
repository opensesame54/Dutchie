import React, { createContext, useContext, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet, Animated, ActivityIndicator,
  useColorScheme, type ViewStyle, type TextStyle,
} from 'react-native';
import { themes, spacing, radius, typography, MIN_TOUCH_TARGET, type Palette } from '../theme';
import { formatMoney } from '../lib/money';

const ThemeContext = createContext<Palette>(themes.light);
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  return (
    <ThemeContext.Provider value={scheme === 'dark' ? themes.dark : themes.light}>
      {children}
    </ThemeContext.Provider>
  );
}

// --- Text ---------------------------------------------------------------

type TextVariant = keyof typeof typography;

export function T({
  variant = 'body', color, style, children, numberOfLines,
}: {
  variant?: TextVariant;
  color?: string;
  style?: TextStyle;
  children: React.ReactNode;
  numberOfLines?: number;
}) {
  const c = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[typography[variant], { color: color ?? c.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return (
    <T variant="sectionTitle" color={c.inkFaint} style={{ textTransform: 'uppercase', marginBottom: spacing.sm }}>
      {children}
    </T>
  );
}

// --- Ledger row ---------------------------------------------------------

/**
 * A receipt line: label on the left, amount on the right, dotted leader
 * connecting them. The leader is what makes a long list scan as a ledger
 * rather than as a generic settings list.
 */
export function LedgerRow({
  label, sublabel, amountMinor, currency, tone = 'neutral', onPress, right,
}: {
  label: string;
  sublabel?: string;
  amountMinor?: number;
  currency?: string;
  tone?: 'neutral' | 'positive' | 'negative';
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  const c = useTheme();
  const amountColor =
    tone === 'positive' ? c.positive : tone === 'negative' ? c.negative : c.ink;

  const content = (
    <View style={styles.ledgerRow}>
      <View style={{ flexShrink: 1 }}>
        <T variant="bodyStrong" numberOfLines={1}>{label}</T>
        {sublabel ? (
          <T variant="caption" color={c.inkFaint} numberOfLines={1} style={{ marginTop: 2 }}>
            {sublabel}
          </T>
        ) : null}
      </View>

      {/* The dotted leader stretches to fill whatever space is left. */}
      <View style={[styles.leader, { borderBottomColor: c.rule }]} />

      {right ?? (
        amountMinor !== undefined && currency ? (
          <T variant="amount" color={amountColor}>
            {formatMoney(amountMinor, currency)}
          </T>
        ) : null
      )}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: c.ochreSoft }}
      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
    >
      {content}
    </Pressable>
  );
}

// --- Card ---------------------------------------------------------------

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const c = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.paperRaised, borderColor: c.rule }, style]}>
      {children}
    </View>
  );
}

// --- Buttons ------------------------------------------------------------

export function Button({
  title, onPress, variant = 'primary', loading, disabled, style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const c = useTheme();
  const isDisabled = disabled || loading;

  const bg =
    variant === 'primary' ? c.ochre : variant === 'danger' ? c.negative : 'transparent';
  const fg = variant === 'secondary' ? c.ink : '#FFFFFF';

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      android_ripple={{ color: 'rgba(0,0,0,0.12)' }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: variant === 'secondary' ? c.rule : 'transparent',
          borderWidth: variant === 'secondary' ? 1 : 0,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[typography.bodyStrong, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

/**
 * Floating action button. Sits bottom-right above the tab bar, within thumb
 * reach for one-handed use.
 */
export function Fab({ onPress, label = '+' }: { onPress: () => void; label?: string }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Add expense"
      android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: true }}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: c.ochre, transform: [{ scale: pressed ? 0.94 : 1 }] },
      ]}
    >
      <Text style={styles.fabLabel}>{label}</Text>
    </Pressable>
  );
}

// --- Input --------------------------------------------------------------

export function Field({
  label, value, onChangeText, placeholder, error, secureTextEntry, keyboardType,
  autoCapitalize, autoFocus, mono,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'decimal-pad';
  autoCapitalize?: 'none' | 'words' | 'sentences';
  autoFocus?: boolean;
  mono?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <T variant="caption" color={c.inkSoft} style={{ marginBottom: spacing.xs }}>
        {label}
      </T>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.inkFaint}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoFocus={autoFocus}
        accessibilityLabel={label}
        style={[
          styles.input,
          mono ? { fontFamily: typography.amount.fontFamily, fontSize: 20 } : null,
          {
            backgroundColor: c.paperRaised,
            borderColor: error ? c.negative : c.rule,
            color: c.ink,
          },
        ]}
      />
      {error ? (
        <T variant="caption" color={c.negative} style={{ marginTop: spacing.xs }}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

// --- States -------------------------------------------------------------

export function EmptyState({
  title, message, action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={styles.empty}>
      <T variant="bodyStrong" style={{ marginBottom: spacing.xs, textAlign: 'center' }}>
        {title}
      </T>
      <T variant="body" color={c.inkFaint} style={{ textAlign: 'center', marginBottom: spacing.lg }}>
        {message}
      </T>
      {action}
    </View>
  );
}

/** Shimmering placeholder — never a blank white screen while loading. */
export function Skeleton({ height = 20, width = '100%' }: { height?: number; width?: number | string }) {
  const c = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.85, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={{
        height,
        width: width as ViewStyle['width'],
        borderRadius: radius.sm,
        backgroundColor: c.rule,
        opacity: pulse,
        marginBottom: spacing.sm,
      }}
    />
  );
}

export function LedgerSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={{ paddingVertical: spacing.sm }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
          <Skeleton height={16} width={`${45 + ((i * 13) % 30)}%`} />
          <View style={{ flex: 1 }} />
          <Skeleton height={16} width={64} />
        </View>
      ))}
    </View>
  );
}

export function Divider() {
  const c = useTheme();
  return <View style={{ height: 1, backgroundColor: c.rule, marginVertical: spacing.sm }} />;
}

const styles = StyleSheet.create({
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  leader: {
    flex: 1,
    borderBottomWidth: 1,
    borderStyle: 'dotted',
    marginBottom: 4,
    minWidth: spacing.lg,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fabLabel: {
    color: '#FFFFFF',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '400',
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl * 2,
    paddingHorizontal: spacing.xl,
  },
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xxl * 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    elevation: 8,
  },
  offlineBanner: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
});

// --- Toast --------------------------------------------------------------

/**
 * Minimal toast host. Optimistic mutations roll the cache back on failure,
 * which is silent by design — the toast is what tells the user their expense
 * did not actually save.
 */
export type ToastTone = 'info' | 'error' | 'success';

interface ToastState {
  message: string;
  tone: ToastTone;
  key: number;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  const [toast, setToast] = React.useState<ToastState | null>(null);
  const slide = useRef(new Animated.Value(0)).current;

  const show = React.useCallback(
    (message: string, tone: ToastTone = 'info') => {
      setToast({ message, tone, key: Date.now() });
    },
    [],
  );

  useEffect(() => {
    if (!toast) return undefined;

    slide.setValue(0);
    Animated.timing(slide, { toValue: 1, duration: 180, useNativeDriver: true }).start();

    const timer = setTimeout(() => {
      Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: true }).start(
        () => setToast(null),
      );
    }, 3200);

    return () => clearTimeout(timer);
  }, [toast, slide]);

  const background =
    toast?.tone === 'error' ? c.negative : toast?.tone === 'success' ? c.positive : c.ink;

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[
            styles.toast,
            {
              backgroundColor: background,
              opacity: slide,
              transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
            },
          ]}
        >
          <Text style={[typography.body, { color: '#FFFFFF' }]}>{toast.message}</Text>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

/** Banner shown while the device is offline or has queued expenses. */
export function OfflineBanner({ pendingCount }: { pendingCount: number }) {
  const c = useTheme();
  if (pendingCount === 0) return null;

  return (
    <View style={[styles.offlineBanner, { backgroundColor: c.ochreSoft, borderColor: c.rule }]}>
      <T variant="caption" color={c.inkSoft}>
        {pendingCount} expense{pendingCount === 1 ? '' : 's'} waiting to sync
      </T>
    </View>
  );
}
