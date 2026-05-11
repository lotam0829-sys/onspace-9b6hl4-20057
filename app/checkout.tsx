import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import { useAuth, useAlert } from '@/template';
import { useOrders } from '@/hooks/useOrders';
import { initializePayment, purchaseNumber } from '@/services/paystackService';
import { Colors, Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

export default function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { refreshOrders } = useOrders();
  const { showAlert } = useAlert();

  const params = useLocalSearchParams<{
    provider_code: string;
    country_code: string;
    country_name: string;
    project_code: string;
    project_name: string;
    price: string;
  }>();

  const [loading, setLoading] = useState(false);
  const [webViewUrl, setWebViewUrl] = useState<string | null>(null);
  const [paystackRef, setPaystackRef] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<{ message: string; hint?: string } | null>(null);

  const price = parseFloat(params.price || '0');

  const parsePurchaseError = (rawMessage: string): { message: string; hint?: string } => {
    const msg = rawMessage.replace(/^Socially:\s*/i, '').trim();
    const lower = msg.toLowerCase();
    if (lower.includes('insufficient') || lower.includes('balance') || lower.includes('fund')) {
      return { message: msg, hint: 'Provider account balance is low. Please try again shortly or contact support.' };
    }
    if (lower.includes('not found') || lower.includes('route') || lower.includes('404')) {
      return { message: msg, hint: 'This provider or country is currently unavailable. Try a different country.' };
    }
    if (lower.includes('unavailable') || lower.includes('no number') || lower.includes('out of stock') || lower.includes('stock')) {
      return { message: msg, hint: 'No numbers are available for this country right now. Try a different country.' };
    }
    if (lower.includes('unauthorized') || lower.includes('invalid token') || lower.includes('403') || lower.includes('401')) {
      return { message: msg, hint: 'API authentication issue. Please contact support.' };
    }
    if (lower.includes('project') || lower.includes('platform') || lower.includes('service')) {
      return { message: msg, hint: 'This platform may not be available on the selected provider/country combination.' };
    }
    if (lower.includes('payment') || lower.includes('verify')) {
      return { message: msg, hint: 'Payment could not be verified. Please contact support with your reference.' };
    }
    return { message: msg };
  };

  const executePurchase = async (reference: string) => {
    setPurchaseError(null);
    setLoading(true);
    try {
      const data = await purchaseNumber({
        provider_code: params.provider_code,
        country_code: parseInt(params.country_code),
        project_code: params.project_code,
        project_name: params.project_name,
        country_name: params.country_name,
        amount_paid: price,
        paystack_reference: reference,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshOrders();

      const orderId = data?.data?.order?.id;
      if (orderId) {
        router.replace({
          pathname: '/number-display',
          params: { order_id: orderId },
        });
      }
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const parsed = parsePurchaseError(e.message || 'Purchase failed. Please try again.');
      setPurchaseError(parsed);
    } finally {
      setLoading(false);
    }
  };

  const handlePay = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPurchaseError(null);
    setLoading(true);
    try {
      const data = await initializePayment(user?.email || '', price, 'number_purchase');
      if (data?.data?.authorization_url) {
        setPaystackRef(data.data.reference);
        setWebViewUrl(data.data.authorization_url);
      }
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPurchaseError({ message: e.message || 'Payment initialization failed. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const handleWebViewNav = async (url: string) => {
    if (url.includes('numvault.app/payment/callback') || url.includes('paystack.com/close')) {
      setWebViewUrl(null);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (paystackRef) {
        // Small delay to let Paystack finalize the transaction
        setTimeout(() => executePurchase(paystackRef), 1500);
      } else {
        setPurchaseError({ message: 'Payment reference lost. Please contact support.' });
      }
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          style={styles.backBtn}
        >
          <MaterialIcons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {/* Order Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Order Summary</Text>
          <View style={styles.summaryRow}>
            <View style={styles.platformIcon}>
              <MaterialIcons name="phone-android" size={24} color={Colors.primary} />
            </View>
            <View style={styles.summaryInfo}>
              <Text style={styles.summaryPlatform}>{params.project_name}</Text>
              <Text style={styles.summaryCountry}>{params.country_name} verification number</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Total</Text>
            <Text style={styles.priceValue}>₦{price.toLocaleString()}</Text>
          </View>
        </View>

        {/* Payment Method Info */}
        <View style={styles.paymentSection}>
          <Text style={styles.paymentTitle}>Payment Method</Text>
          <View style={styles.paymentCard}>
            <View style={styles.paymentIconRow}>
              <View style={styles.paymentMethodIcon}>
                <MaterialIcons name="credit-card" size={18} color={Colors.primary} />
              </View>
              <View style={styles.paymentMethodIcon}>
                <MaterialIcons name="account-balance" size={18} color={Colors.primary} />
              </View>
              <View style={styles.paymentMethodIcon}>
                <MaterialIcons name="smartphone" size={18} color={Colors.primary} />
              </View>
            </View>
            <View style={styles.paymentCardInfo}>
              <Text style={styles.paymentCardTitle}>Paystack Secure Checkout</Text>
              <Text style={styles.paymentCardSub}>Card · Bank Transfer · USSD — your choice</Text>
            </View>
          </View>
        </View>

        {/* Purchase Error Banner */}
        {purchaseError && (
          <View style={styles.errorBanner}>
            <View style={styles.errorBannerHeader}>
              <MaterialIcons name="error-outline" size={18} color={Colors.error} />
              <Text style={styles.errorBannerTitle}>Purchase Failed</Text>
              <TouchableOpacity
                onPress={async () => {
                  await Haptics.selectionAsync();
                  setPurchaseError(null);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="close" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.errorBannerMessage}>{purchaseError.message}</Text>
            {purchaseError.hint && (
              <View style={styles.errorBannerHint}>
                <MaterialIcons name="lightbulb-outline" size={13} color={Colors.warning} />
                <Text style={styles.errorBannerHintText}>{purchaseError.hint}</Text>
              </View>
            )}
            <View style={styles.errorBannerActions}>
              <TouchableOpacity
                style={styles.errorActionBtn}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.back();
                }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="arrow-back" size={14} color={Colors.primary} />
                <Text style={styles.errorActionText}>Change Selection</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.errorActionBtn, styles.errorActionBtnRetry]}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  await handlePay();
                }}
                disabled={loading}
                activeOpacity={0.8}
              >
                <MaterialIcons name="refresh" size={14} color={Colors.black} />
                <Text style={[styles.errorActionText, styles.errorActionTextRetry]}>Try Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* What happens next */}
        <View style={styles.whatsNext}>
          <Text style={styles.whatsNextTitle}>What happens next</Text>
          {[
            'Choose card, bank transfer, or USSD on the payment page',
            'Payment is processed securely via Paystack',
            'A temporary phone number is instantly assigned to you',
            'Your OTP is automatically captured and shown here',
          ].map((step, i) => (
            <View key={i} style={styles.nextStep}>
              <View style={styles.nextStepNum}>
                <Text style={styles.nextStepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.nextStepText}>{step}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={[styles.ctaContainer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.ctaInfo}>
          <MaterialIcons name="lock" size={14} color={Colors.textSecondary} />
          <Text style={styles.ctaInfoText}>Secured by Paystack · Card · Transfer · USSD</Text>
        </View>
        <TouchableOpacity
          style={[styles.ctaBtn, loading && styles.ctaBtnDisabled]}
          onPress={handlePay}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={Colors.black} />
          ) : (
            <>
              <MaterialIcons name="payment" size={18} color={Colors.black} />
              <Text style={styles.ctaBtnText}>Pay ₦{price.toLocaleString()}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Paystack WebView */}
      <Modal visible={!!webViewUrl} animationType="slide" onRequestClose={() => setWebViewUrl(null)}>
        <View style={[styles.webViewContainer, { paddingTop: insets.top }]}>
          <View style={styles.webViewHeader}>
            <TouchableOpacity onPress={() => setWebViewUrl(null)}>
              <MaterialIcons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.webViewTitle}>Secure Payment</Text>
            <View style={{ width: 24 }} />
          </View>
          {webViewUrl && (
            <WebView
              source={{ uri: webViewUrl }}
              onNavigationStateChange={(state) => handleWebViewNav(state.url)}
              startInLoadingState
              renderLoading={() => <ActivityIndicator color={Colors.primary} style={{ flex: 1 }} />}
            />
          )}
        </View>
      </Modal>
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
  summaryCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  summaryTitle: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  platformIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryInfo: { flex: 1 },
  summaryPlatform: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  summaryCountry: { color: Colors.textSecondary, fontSize: FontSize.sm },
  divider: { height: 1, backgroundColor: Colors.surfaceBorder },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceLabel: { color: Colors.textSecondary, fontSize: FontSize.md },
  priceValue: { color: Colors.primary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  paymentSection: { gap: Spacing.md },
  paymentTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  paymentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    backgroundColor: Colors.primaryMuted,
  },
  paymentIconRow: { flexDirection: 'row', gap: 6 },
  paymentMethodIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentCardInfo: { flex: 1 },
  paymentCardTitle: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  paymentCardSub: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 2 },
  whatsNext: { gap: Spacing.md },
  whatsNextTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  nextStep: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  nextStepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primaryMuted,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  nextStepNumText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  nextStepText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 22 },
  ctaContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    gap: Spacing.sm,
  },
  ctaInfo: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center' },
  ctaInfoText: { color: Colors.textSecondary, fontSize: FontSize.xs },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    height: 52,
    justifyContent: 'center',
  },
  ctaBtnDisabled: { opacity: 0.5 },
  ctaBtnText: { color: Colors.black, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  webViewContainer: { flex: 1, backgroundColor: Colors.background },
  webViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  webViewTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  errorBanner: {
    backgroundColor: Colors.errorMuted,
    borderWidth: 1,
    borderColor: Colors.error,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  errorBannerHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  errorBannerTitle: { flex: 1, color: Colors.error, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  errorBannerMessage: {
    color: Colors.text,
    fontSize: FontSize.sm,
    lineHeight: 22,
    fontFamily: 'monospace',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
  },
  errorBannerHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.warningMuted,
    borderRadius: Radius.sm,
    padding: Spacing.md,
  },
  errorBannerHintText: { flex: 1, color: Colors.warning, fontSize: FontSize.xs, lineHeight: 18 },
  errorBannerActions: { flexDirection: 'row', gap: Spacing.sm },
  errorActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 10,
  },
  errorActionBtnRetry: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  errorActionText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  errorActionTextRetry: { color: Colors.black },
});
