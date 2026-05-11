import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar,
  Clipboard, Animated, ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAlert } from '@/template';
import { fetchOrder, updateOrderExpired, Order } from '@/services/orderService';
import { requestNotificationPermissions, sendOTPReceivedNotification } from '@/services/notificationService';
import { getSupabaseClient } from '@/template';
import { getOTP } from '@/services/sociallyService';
import { OTP_POLL_INTERVAL, OTP_TIMEOUT } from '@/constants/config';
import { Colors, Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

const supabase = getSupabaseClient();

export default function NumberDisplayScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { order_id } = useLocalSearchParams<{ order_id: string }>();

  const [order, setOrder] = useState<Order | null>(null);
  const [timeLeft, setTimeLeft] = useState(OTP_TIMEOUT / 1000);
  const [expired, setExpired] = useState(false);
  const [copiedNumber, setCopiedNumber] = useState(false);
  const [copiedOTP, setCopiedOTP] = useState(false);

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!order_id) return;
    requestNotificationPermissions();
    loadOrder();
    startPolling();
    startTimer();
    startPulse();

    return () => {
      clearInterval(pollRef.current!);
      clearInterval(timerRef.current!);
    };
  }, [order_id]);

  const loadOrder = async () => {
    const data = await fetchOrder(order_id);
    if (data) setOrder(data);
  };

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  };

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      // First check local DB for OTP (may have been set by webhook)
      const data = await fetchOrder(order_id);
      if (data) {
        setOrder(data);
        if (data.otp || data.status === 'completed') {
          clearInterval(pollRef.current!);
          clearInterval(timerRef.current!);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          if (data.otp) {
            await sendOTPReceivedNotification(data.project_name || 'Platform', data.otp);
          }
          return;
        }
        // If no OTP in DB yet, poll Socially.ng directly using order_reference
        if (data.order_reference) {
          try {
            const { otp } = await getOTP(data.order_reference);
            if (otp) {
              // Save OTP to DB and update local state
              const supabase = getSupabaseClient();
              await supabase
                .from('orders')
                .update({ otp, status: 'completed' })
                .eq('id', order_id);
              setOrder((prev) => prev ? { ...prev, otp, status: 'completed' } : prev);
              clearInterval(pollRef.current!);
              clearInterval(timerRef.current!);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await sendOTPReceivedNotification(data.project_name || 'Platform', otp);
            }
          } catch {
            // Silently ignore OTP poll errors
          }
        }
      }
    }, OTP_POLL_INTERVAL);
  };

  const startTimer = () => {
    let remaining = OTP_TIMEOUT / 1000;
    timerRef.current = setInterval(async () => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current!);
        clearInterval(pollRef.current!);
        setExpired(true);
        await updateOrderExpired(order_id);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    }, 1000);
  };

  const copyToClipboard = async (text: string, type: 'number' | 'otp') => {
    Clipboard.setString(text);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (type === 'number') {
      setCopiedNumber(true);
      setTimeout(() => setCopiedNumber(false), 2000);
    } else {
      setCopiedOTP(true);
      setTimeout(() => setCopiedOTP(false), 2000);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const otpReceived = !!(order?.otp || order?.status === 'completed');
  const progressPct = Math.max(0, (timeLeft / (OTP_TIMEOUT / 1000)) * 100);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/(tabs)/orders');
          }}
          style={styles.backBtn}
        >
          <MaterialIcons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Number</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* Platform info */}
        {order && (
          <View style={styles.platformRow}>
            <MaterialIcons name="phone-android" size={20} color={Colors.primary} />
            <Text style={styles.platformText}>{order.project_name} — {order.country_name}</Text>
          </View>
        )}

        {/* Phone number card */}
        <View style={styles.numberCard}>
          <Text style={styles.numberLabel}>Your Temporary Number</Text>
          {order?.phone_number ? (
            <>
              <Animated.Text style={[styles.phoneNumber, { transform: [{ scale: pulseAnim }] }]}>
                {order.phone_number}
              </Animated.Text>
              <TouchableOpacity
                style={[styles.copyBtn, copiedNumber && styles.copyBtnDone]}
                onPress={() => copyToClipboard(order.phone_number!, 'number')}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name={copiedNumber ? "check" : "content-copy"}
                  size={16}
                  color={copiedNumber ? Colors.black : Colors.text}
                />
                <Text style={[styles.copyText, copiedNumber && styles.copyTextDone]}>
                  {copiedNumber ? "Copied!" : "Copy Number"}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.loading}>
              <MaterialIcons name="hourglass-empty" size={32} color={Colors.textMuted} />
              <Text style={styles.loadingText}>Assigning your number...</Text>
            </View>
          )}
        </View>

        {/* OTP section */}
        <View style={styles.otpCard}>
          {otpReceived ? (
            <>
              <View style={styles.otpSuccess}>
                <MaterialIcons name="check-circle" size={32} color={Colors.success} />
                <Text style={styles.otpSuccessLabel}>OTP Received!</Text>
              </View>
              <Text style={styles.otpCode}>{order?.otp}</Text>
              <TouchableOpacity
                style={[styles.copyBtn, styles.copyBtnOtp, copiedOTP && styles.copyBtnDone]}
                onPress={() => order?.otp && copyToClipboard(order.otp, 'otp')}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name={copiedOTP ? "check" : "content-copy"}
                  size={16}
                  color={copiedOTP ? Colors.black : Colors.primary}
                />
                <Text style={[styles.copyText, styles.copyTextOtp, copiedOTP && styles.copyTextDone]}>
                  {copiedOTP ? "Copied!" : "Copy OTP"}
                </Text>
              </TouchableOpacity>
            </>
          ) : expired ? (
            <View style={styles.expiredBox}>
              <MaterialIcons name="schedule" size={32} color={Colors.error} />
              <Text style={styles.expiredTitle}>OTP Not Received</Text>
              <Text style={styles.expiredText}>
                The 2-minute window has expired. Please contact support — we will process a refund for you.
              </Text>
              <TouchableOpacity
                style={styles.supportBtn}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  showAlert('Contact Support', 'Please email support@numvault.ng with your order ID: ' + order_id);
                }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="support-agent" size={16} color={Colors.black} />
                <Text style={styles.supportBtnText}>Contact Support</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.waitingBox}>
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <MaterialIcons name="sms" size={32} color={Colors.primary} />
              </Animated.View>
              <Text style={styles.waitingTitle}>Waiting for your OTP...</Text>
              <Text style={styles.waitingText}>
                Enter the number above on {order?.project_name || 'the platform'} and request an OTP. It will appear here automatically.
              </Text>

              {/* Timer */}
              <View style={styles.timerBox}>
                <View style={[styles.timerBar, { width: `${progressPct}%` as any }]} />
                <Text style={[styles.timerText, timeLeft < 30 && { color: Colors.error }]}>
                  {formatTime(timeLeft)}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Instructions */}
        <View style={styles.instructions}>
          <Text style={styles.instructTitle}>How to use this number</Text>
          {[
            { icon: 'content-copy', text: `Copy the number above` },
            { icon: 'open-in-new', text: `Open ${order?.project_name || 'the app'} and enter it as your phone number` },
            { icon: 'sms', text: `Request an SMS verification code` },
            { icon: 'auto-awesome', text: `Your OTP will appear here automatically within 2 minutes` },
          ].map((step, i) => (
            <View key={i} style={styles.instructRow}>
              <View style={styles.instructIcon}>
                <MaterialIcons name={step.icon as any} size={14} color={Colors.primary} />
              </View>
              <Text style={styles.instructText}>{step.text}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.viewOrdersBtn}
          onPress={async () => {
            await Haptics.selectionAsync();
            router.push('/(tabs)/orders');
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.viewOrdersText}>View All Orders</Text>
          <MaterialIcons name="chevron-right" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  content: { padding: Spacing.lg, gap: Spacing.lg },
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryMuted,
    borderRadius: Radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  platformText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  numberCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  numberLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
  phoneNumber: {
    color: Colors.text,
    fontSize: FontSize.xxxl,
    fontWeight: FontWeight.bold,
    letterSpacing: 2,
    textAlign: 'center',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.full,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.surfaceElevated,
  },
  copyBtnOtp: { borderColor: Colors.primary, backgroundColor: Colors.primaryMuted },
  copyBtnDone: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  copyText: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  copyTextOtp: { color: Colors.primary },
  copyTextDone: { color: Colors.black },
  loading: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.sm },
  otpCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  otpSuccess: { alignItems: 'center', gap: Spacing.sm },
  otpSuccessLabel: { color: Colors.success, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  otpCode: {
    color: Colors.primary,
    fontSize: 48,
    fontWeight: FontWeight.bold,
    letterSpacing: 8,
  },
  waitingBox: { alignItems: 'center', gap: Spacing.md, width: '100%' },
  waitingTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  waitingText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 22,
    textAlign: 'center',
  },
  timerBox: {
    width: '100%',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.full,
    height: 36,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  timerBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Colors.primaryMuted,
    borderRadius: Radius.full,
  },
  timerText: {
    color: Colors.primary,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    zIndex: 1,
  },
  expiredBox: { alignItems: 'center', gap: Spacing.md },
  expiredTitle: { color: Colors.error, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  expiredText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 22,
    textAlign: 'center',
  },
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.error,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  supportBtnText: { color: Colors.black, fontWeight: FontWeight.bold, fontSize: FontSize.sm },
  instructions: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  instructTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  instructRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  instructIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  instructText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 22 },
  viewOrdersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.md,
  },
  viewOrdersText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
