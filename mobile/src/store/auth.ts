import { create } from 'zustand';
import { request, tokenStore, setUnauthenticatedHandler } from '../lib/api';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  /** True until the stored session has been checked on cold start. */
  initializing: boolean;
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
    try {
      const { accessToken } = await tokenStore.get();
      if (!accessToken) {
        set({ user: null, initializing: false });
        return;
      }
      // Validate rather than trust: the token may have expired while the app
      // was closed, and /me will transparently refresh if it can.
      const { user } = await request<{ user: User }>('/auth/me');
      set({ user, initializing: false });
    } catch {
      await tokenStore.clear();
      set({ user: null, initializing: false });
    }
  },

  async login(email, password) {
    const data = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      anonymous: true,
      body: { email, password },
    });
    await tokenStore.set(data.accessToken, data.refreshToken);
    set({ user: data.user });
  },

  async signup(name, email, password) {
    const data = await request<AuthResponse>('/auth/signup', {
      method: 'POST',
      anonymous: true,
      body: { name, email, password },
    });
    await tokenStore.set(data.accessToken, data.refreshToken);
    set({ user: data.user });
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
    set({ user: null });
  },

  setUser(user) {
    set({ user });
  },
}));

// When a refresh fails mid-session, drop straight back to the login screen.
setUnauthenticatedHandler(() => {
  useAuth.setState({ user: null });
});
