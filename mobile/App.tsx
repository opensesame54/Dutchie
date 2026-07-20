import React, { useEffect } from 'react';
import { View, ActivityIndicator, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './src/components/ui';
import { RootNavigator } from './src/navigation';
import { LoginScreen } from './src/screens/LoginScreen';
import { useAuth } from './src/store/auth';
import { themes } from './src/theme';
import { ApiError } from './src/lib/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Balances change whenever anyone in the group adds an expense, so a
      // short stale time keeps numbers honest without hammering the API.
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // A 4xx will not fix itself on retry; only network blips are worth
        // repeating, which matters on a flaky mobile connection.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});

function Root() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? themes.dark : themes.light;
  const { user, initializing, restore } = useAuth();

  useEffect(() => {
    restore();
  }, [restore]);

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
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <Root />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
