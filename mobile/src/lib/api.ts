import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * API client with automatic token refresh.
 *
 * Tokens live in expo-secure-store (the Android Keystore), never in
 * AsyncStorage — AsyncStorage is plain unencrypted files, and there is no
 * localStorage on native at all.
 */

const ACCESS_KEY = 'dutchie.accessToken';
const REFRESH_KEY = 'dutchie.refreshToken';

/**
 * An Android emulator reaches the host machine at 10.0.2.2, not localhost —
 * localhost there is the emulator itself. A physical device needs the host's
 * LAN IP, so this is overridable via EXPO_PUBLIC_API_URL.
 */
function defaultBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (__DEV__ && Platform.OS === 'android') return 'http://10.0.2.2:4000';
  return 'http://localhost:4000';
}

export const API_BASE_URL = defaultBaseUrl();

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokenStore = {
  async get() {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
    ]);
    return { accessToken, refreshToken };
  },
  async set(accessToken: string, refreshToken: string) {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_KEY, accessToken),
      SecureStore.setItemAsync(REFRESH_KEY, refreshToken),
    ]);
  },
  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
  },
};

/** Called when refresh fails, so the app can drop back to the login screen. */
let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

/** Refresh could not reach the server — distinct from the server refusing. */
const OFFLINE = Symbol('offline');
type RefreshResult = string | null | typeof OFFLINE;

// A single in-flight refresh shared by every waiting request; without this, a
// screen firing five queries at once would burn five refresh tokens and all but
// one would fail against the rotation check.
let refreshInFlight: Promise<RefreshResult> | null = null;

async function refreshAccessToken(): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const { refreshToken } = await tokenStore.get();
    if (!refreshToken) return null;

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        // The server saw the token and refused it: the session is dead.
        await tokenStore.clear();
        onUnauthenticated?.();
        return null;
      }

      const data = await res.json();
      await tokenStore.set(data.accessToken, data.refreshToken);
      return data.accessToken as string;
    } catch {
      // Could not reach the server at all. The refresh token is probably still
      // perfectly valid, so this must be reported as offline rather than
      // collapsing into the same null that means "signed out".
      return OFFLINE;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (login, signup). */
  anonymous?: boolean;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const send = async (token: string | null): Promise<Response> =>
    fetch(`${API_BASE_URL}/api${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });

  let token: string | null = null;
  if (!opts.anonymous) {
    token = (await tokenStore.get()).accessToken;
  }

  let res: Response;
  try {
    res = await send(token);
  } catch {
    // fetch only rejects on a genuine network failure, which is exactly the
    // case the offline UI needs to distinguish from a server error.
    throw new ApiError(0, 'No connection. Check your network and try again.');
  }

  // Access tokens are short-lived; one transparent retry after refreshing.
  if (res.status === 401 && !opts.anonymous) {
    const fresh = await refreshAccessToken();

    if (fresh === OFFLINE) {
      // Lost the connection mid-refresh. Report it as a network failure so
      // callers can fall back to cache, rather than as a dead session.
      throw new ApiError(0, 'No connection. Check your network and try again.');
    }

    if (fresh) {
      res = await send(fresh);
    } else {
      onUnauthenticated?.();
    }
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? 'Something went wrong', data?.details);
  }

  return data as T;
}
