import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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

export async function sendOTPReceivedNotification(platform: string, otp: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🔐 OTP Received!',
      body: `Your ${platform} verification code is: ${otp}`,
      data: { type: 'otp_received', otp },
      sound: true,
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
