import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ThemeProvider, ToastProvider, useToast } from './src/components/ui';
import { RootNavigator } from './src/navigation';
import { LoginScreen } from './src/screens/LoginScreen';
import { useAuth } from './src/store/auth';
import { themes } from './src/theme';
import { queryClient, persistOptions, startConnectivityTracking } from './src/lib/offline';
import { startOutboxSync, flushOutbox } from './src/lib/outbox';
import { registerForPush } from './src/lib/push';

function Root() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? themes.dark : themes.light;
  const { user, initializing, restore } = useAuth();
  const toast = useToast();
  const [pushChecked, setPushChecked] = useState(false);

  useEffect(() => {
    restore();
  }, [restore]);

  // Track connectivity for the whole app lifetime, and flush queued expenses
  // whenever the connection returns.
  useEffect(() => {
    const stopTracking = startConnectivityTracking();
    const stopSync = startOutboxSync((result) => {
      if (result.sent > 0) {
        toast(`Synced ${result.sent} queued expense${result.sent === 1 ? '' : 's'}`, 'success');
      }
      if (result.failed > 0) {
        toast(`${result.failed} queued expense${result.failed === 1 ? '' : 's'} could not sync`, 'error');
      }
    });

    return () => {
      stopTracking();
      stopSync();
    };
  }, [toast]);

  // Register for push once, after sign-in. Failure is non-fatal: the in-app
  // notification list still works without a push token.
  useEffect(() => {
    if (!user || pushChecked) return;
    setPushChecked(true);

    void registerForPush().then((result) => {
      if (!result.registered && __DEV__) {
        console.log(`[push] not registered: ${result.reason}`);
      }
    });

    // Anything queued from a previous session should go out now.
    void flushOutbox();
  }, [user, pushChecked]);

  if (initializing) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: c.paper,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={c.ochre} size="large" />
      </View>
    );
  }

  return user ? <RootNavigator /> : <LoginScreen />;
}

export default function App() {
  const scheme = useColorScheme();

  return (
    <SafeAreaProvider>
      {/* Persisting the cache is what makes a cold start with no connection
          show the last known balances instead of empty states. */}
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <ThemeProvider>
          <ToastProvider>
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <Root />
          </ToastProvider>
        </ThemeProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
