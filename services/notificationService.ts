import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { getSupabaseClient } from '@/template';

// Configure how notifications are displayed when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// Register the device's Expo push token in user_profiles so server-side
// functions (e.g. auto-expire-orders) can send push notifications.
export async function registerPushToken(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const granted = await requestNotificationPermissions();
    if (!granted) return;
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const pushToken = tokenData.data;
    if (!pushToken) return;

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('user_profiles')
      .update({ push_token: pushToken })
      .eq('id', user.id);

    console.log('Push token registered:', pushToken);
  } catch (e) {
    console.warn('Failed to register push token:', e);
  }
}

export async function sendOTPReceivedNotification(platform: string, otp: string) {
  // Vibrate the device with a success pattern
  if (Platform.OS !== 'web') {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Double-pulse vibration for emphasis
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 300);
  }

  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🔐 OTP Received!',
      body: `Your ${platform} code is: ${otp} — Tap to copy`,
      data: { type: 'otp_received', otp, platform },
      sound: true,
      // Android priority
      priority: Notifications.AndroidNotificationPriority.MAX,
      vibrationPattern: [0, 250, 100, 250],
    },
    trigger: null, // Send immediately
  });
}

export async function sendLowBalanceNotification(balance: number) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '💳 Low Wallet Balance',
      body: `Your NumVault balance is ₦${balance.toLocaleString()}. Top up now to continue buying numbers.`,
      data: { type: 'low_balance', balance },
      sound: true,
    },
    trigger: null, // Send immediately
  });
}
