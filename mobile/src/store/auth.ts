import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { request, tokenStore, setUnauthenticatedHandler, ApiError } from '../lib/api';
import type { User } from '../types';

/**
 * The signed-in user's profile, cached so a cold start with no connection can
 * render the app from the persisted query cache instead of bouncing to login.
 *
 * Tokens deliberately do NOT live here — they stay in expo-secure-store, which
 * is backed by the Android Keystore. A name and email are not secrets; a
 * refresh token is.
 */
const PROFILE_KEY = 'dutchie.cachedProfile';

async function cacheProfile(user: User): Promise<void> {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(user)).catch(() => undefined);
}

async function readCachedProfile(): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

/**
 * True only when fetch itself rejected, which api.ts reports as status 0. A
 * real server response — including a 401 — never looks like this, so it is a
 * safe signal for "the network is down" rather than "the session is invalid".
 */
function isOffline(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

interface AuthState {
  user: User | null;
  /** True until the stored session has been checked on cold start. */
  initializing: boolean;
  /** Session restored from cache without reaching the server. */
  offlineSession: boolean;
  restore: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  initializing: true,

  async restore() {
    const { accessToken } = await tokenStore.get();
    if (!accessToken) {
      set({ user: null, initializing: false, offlineSession: false });
      return;
    }

    try {
      // Validate rather than trust: the token may have expired while the app
      // was closed, and /me will transparently refresh if it can.
      const { user } = await request<{ user: User }>('/auth/me');
      await cacheProfile(user);
      set({ user, initializing: false, offlineSession: false });
    } catch (err) {
      // Being offline is not being logged out. Clearing tokens here was what
      // stranded the app on a login screen it could never get past, with a
      // fully populated query cache sitting unused behind it.
      if (isOffline(err)) {
        const cached = await readCachedProfile();
        if (cached) {
          set({ user: cached, initializing: false, offlineSession: true });
          return;
        }
        // No cached profile to render, but the token may still be good once
        // the network returns, so keep it rather than forcing a re-login.
        set({ user: null, initializing: false, offlineSession: false });
        return;
      }

      // A real rejection from the server: the session is genuinely dead.
      await tokenStore.clear();
      await AsyncStorage.removeItem(PROFILE_KEY).catch(() => undefined);
      set({ user: null, initializing: false, offlineSession: false });
    }
  },

  async login(email, password) {
    const data = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      anonymous: true,
      body: { email, password },
    });
    await tokenStore.set(data.accessToken, data.refreshToken);
    await cacheProfile(data.user);
    set({ user: data.user, offlineSession: false });
  },

  async signup(name, email, password) {
    const data = await request<AuthResponse>('/auth/signup', {
      method: 'POST',
      anonymous: true,
      body: { name, email, password },
    });
    await tokenStore.set(data.accessToken, data.refreshToken);
    await cacheProfile(data.user);
    set({ user: data.user, offlineSession: false });
  },

  async logout() {
    const { refreshToken } = await tokenStore.get();
    if (refreshToken) {
      // Revoke server-side too; a token that only disappears from the device
      // stays valid to anyone who captured it.
      await request('/auth/logout', {
        method: 'POST',
        anonymous: true,
        body: { refreshToken },
      }).catch(() => undefined);
    }
    await tokenStore.clear();
    // Logging out is explicit, so the cached profile goes with it — leaving it
    // behind would let the next cold start silently re-enter the account.
    await AsyncStorage.removeItem(PROFILE_KEY).catch(() => undefined);
    set({ user: null, offlineSession: false });
  },

  setUser(user) {
    set({ user });
    void cacheProfile(user);
  },

  offlineSession: false,
}));

// Only fires when the server actually rejected the refresh token, never on a
// network failure — api.ts checks that before calling this. Signing someone out
// because they walked into a lift would be the same bug in a different place.
setUnauthenticatedHandler(() => {
  void AsyncStorage.removeItem(PROFILE_KEY);
  useAuth.setState({ user: null, offlineSession: false });
});
