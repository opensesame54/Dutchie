import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { request } from './api';

/**
 * Expo push registration.
 *
 * Push (remote) notifications do NOT work in Expo Go on Android from SDK 53
 * onwards — a development build is required. Everything here degrades quietly
 * rather than throwing, so running in Expo Go simply means no push rather than
 * a crash on launch.
 */

const CHANNEL_ID = 'default';

/** Foreground presentation. The banner/list fields are required in SDK 57. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // The channel id must match the one the server sends, or Android drops the
  // notification without any visible error.
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Dutchie',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#B8791F',
  });
}

function resolveProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return extra?.eas?.projectId || undefined;
}

export interface PushRegistration {
  registered: boolean;
  reason?: string;
}

/**
 * Ask for permission, get a token, and hand it to the API. Safe to call on
 * every launch — the server upserts by token.
 */
export async function registerForPush(): Promise<PushRegistration> {
  await ensureAndroidChannel();

  // A simulator has no push service to register against.
  if (!Device.isDevice) {
    return { registered: false, reason: 'Push requires a physical device' };
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  if (status !== 'granted') {
    // Only prompt if we have not been permanently denied; re-prompting a
    // denied user does nothing on Android and just burns the call.
    if (!existing.canAskAgain) {
      return { registered: false, reason: 'Notification permission denied' };
    }
    ({ status } = await Notifications.requestPermissionsAsync());
  }

  if (status !== 'granted') {
    return { registered: false, reason: 'Notification permission not granted' };
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    // Without an EAS project id the token cannot be minted. Say so plainly
    // rather than failing with an opaque SDK error.
    return {
      registered: false,
      reason: 'No EAS projectId configured — run `eas init` and set extra.eas.projectId',
    };
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await request('/notifications/devices', {
      method: 'POST',
      body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    });
    return { registered: true };
  } catch (err) {
    return {
      registered: false,
      reason: err instanceof Error ? err.message : 'Could not register for push',
    };
  }
}

/** Tell the server to stop pushing to this device (called on logout). */
export async function unregisterPush(): Promise<void> {
  const projectId = resolveProjectId();
  if (!projectId || !Device.isDevice) return;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await request(`/notifications/devices/${encodeURIComponent(token)}`, { method: 'DELETE' });
  } catch {
    // Logging out must succeed even if we cannot reach the server.
  }
}

/** Subscribe to taps on a notification. Returns an unsubscribe function. */
export function onNotificationTapped(
  handler: (data: { type?: string; targetId?: string; groupId?: string }) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    handler(response.notification.request.content.data ?? {});
  });
  return () => sub.remove();
}
