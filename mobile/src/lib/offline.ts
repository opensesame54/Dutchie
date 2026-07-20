import { QueryClient, onlineManager, focusManager } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import { ApiError } from './api';

/**
 * Offline support.
 *
 * Two separate problems, solved separately:
 *
 *  READS  — the query cache is persisted to AsyncStorage, so a cold start with
 *           no connection shows the last known balances instead of empty
 *           states. Cached data is explicitly marked stale on reconnect.
 *
 *  WRITES — queued in an outbox (see outbox.ts). React Query's own mutation
 *           persistence is not used because a half-replayed expense is worse
 *           than an explicit queue the user can see and cancel.
 *
 * Note this is AsyncStorage, not SecureStore: auth tokens stay in SecureStore.
 * Cached balances are not secret, and AsyncStorage has no size limit worth
 * worrying about here.
 */

export const CACHE_KEY = 'dutchie.queryCache';

/** Bump to discard every cached page after a shape change. */
const CACHE_BUSTER = 'v1';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Persisted entries older than this are dropped rather than shown; a
      // week-old balance is misleading enough to be worse than a spinner.
      gcTime: 1000 * 60 * 60 * 24 * 7,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      // Without a connection, refetching just burns battery on certain failure.
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: CACHE_KEY,
  throttleTime: 2000,
});

export const persistOptions = {
  persister,
  maxAge: 1000 * 60 * 60 * 24 * 7,
  buster: CACHE_BUSTER,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { state: { status: string } }) =>
      // Never persist a failed query — replaying an error on next launch just
      // shows a stale error banner for data that might be fine now.
      query.state.status === 'success',
  },
};

/**
 * Wire React Query's online/focus managers to real device signals. Without
 * this, React Native never tells React Query the connection came back, so
 * queued refetches sit forever.
 */
export function startConnectivityTracking(): () => void {
  const unsubscribeNet = NetInfo.addEventListener((state) => {
    // `isInternetReachable` is null while unknown; treat that as online rather
    // than blocking every request on an inconclusive probe.
    const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
    onlineManager.setOnline(online);
  });

  const onAppStateChange = (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  };
  const appStateSub = AppState.addEventListener('change', onAppStateChange);

  return () => {
    unsubscribeNet();
    appStateSub.remove();
  };
}

export async function clearPersistedCache(): Promise<void> {
  // Called on logout: the next account must not see the previous one's cached
  // balances for even a frame.
  await AsyncStorage.removeItem(CACHE_KEY);
  queryClient.clear();
}
