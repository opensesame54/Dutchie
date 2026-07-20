import React, { useState } from 'react';
import {
  View, ScrollView, KeyboardAvoidingView, Platform, StyleSheet, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T, Field, Button, useTheme } from '../components/ui';
import { spacing, typography } from '../theme';
import { useAuth } from '../store/auth';
import { ApiError } from '../lib/api';

export function LoginScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { login, signup } = useAuth();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';

  async function submit() {
    setError(null);

    if (isSignup && name.trim().length === 0) {
      setError('What should we call you?');
      return;
    }
    if (!email.includes('@')) {
      setError('That does not look like an email address');
      return;
    }
    if (password.length < 8 && isSignup) {
      setError('Password must be at least 8 characters');
      return;
    }

    setBusy(true);
    try {
      if (isSignup) await signup(name.trim(), email.trim(), password);
      else await login(email.trim(), password);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not reach Dutchie. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.paper }}
      // Android resizes the window itself; adding padding on top of that
      // double-counts the keyboard and pushes the form off-screen.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <T style={{ ...typography.screenTitle, fontSize: 40 }}>Dutchie</T>
          <View style={[styles.rule, { backgroundColor: c.ochre }]} />
          <T variant="body" color={c.inkSoft}>
            Split the bill, keep the friendship.
          </T>
        </View>

        {isSignup ? (
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Ana Ferreira"
            autoCapitalize="words"
          />
        ) : null}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder={isSignup ? 'At least 8 characters' : ''}
          secureTextEntry
          autoCapitalize="none"
        />

        {error ? (
          <T variant="caption" color={c.negative} style={{ marginBottom: spacing.md }}>
            {error}
          </T>
        ) : null}

        <Button
          title={isSignup ? 'Create account' : 'Log in'}
          onPress={submit}
          loading={busy}
        />

        <Pressable
          onPress={() => {
            setMode(isSignup ? 'login' : 'signup');
            setError(null);
          }}
          style={styles.switch}
          accessibilityRole="button"
        >
          <T variant="body" color={c.inkSoft}>
            {isSignup ? 'Already have an account? ' : "New here? "}
            <T variant="bodyStrong" color={c.ochre}>
              {isSignup ? 'Log in' : 'Create an account'}
            </T>
          </T>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
  },
  header: {
    marginBottom: spacing.xxl,
  },
  rule: {
    height: 3,
    width: 56,
    marginVertical: spacing.md,
    borderRadius: 2,
  },
  switch: {
    marginTop: spacing.xl,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
});
