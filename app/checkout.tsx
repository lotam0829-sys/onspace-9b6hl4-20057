import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { useAuth, useAlert } from '@/template';
import { useOrders } from '@/hooks/useOrders';
import { useWallet } from '@/hooks/useWallet';
import { initializePayment, purchaseNumber } from '@/services/paystackService';
import { Colors, Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';
import { PLATFORM_ICONS } from '@/constants/config';

export default function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { refreshOrders } = useOrders();
  const { walletBalance, refreshProfile } = useWallet();
  const { showAlert } = useAlert();

  const params = useLocalSearchParams<{
    provider_code: string;
    country_code: string;
    country_name: string;
    project_code: string;
    project_name: string;
    price: string;
    wholesale_price: string;
  }>();

  const [loading, setLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState<{ message: string; hint?: string } | null>(null);
  const [purchaseStage, setPurchaseStage] = useState<'idle' | 'paying' | 'purchasing'>('idle');

  const price = parseFloat(params.price || '0');
  const wholesalePrice = params.wholesale_price
    ? parseFloat(params.wholesale_price)
    : price / 1.4;

  const parsePurchaseError = (rawMessage: string): { message: string; hint?: string } => {
    const msg = rawMessage.replace(/^Socially:\s*/i, '').trim();
    const lower = msg.toLowerCase();
    if (lower.includes('insufficient') || lower.includes('balance') || lower.includes('fund'))
      return { message: msg, hint: 'Provider balance is low. Try again in a few minutes.' };
    if (lower.includes('unavailable') || lower.includes('no number') || lower.includes('stock'))
      return { message: msg, hint: 'No numbers available for this country right now.' };
    if (lower.includes('not found') || lower.includes('route') || lower.includes('404'))
      return { message: msg, hint: 'Try a different country or platform.' };
    if (lower.includes('unauthorized') || lower.includes('invalid token'))
      return { message: msg, hint: 'Authentication issue. Contact support.' };
    if (lower.includes('payment') || lower.includes('verify'))
      return { message: msg, hint: 'Payment could not be verified. Contact support with your reference.' };
    return { message: msg };
  };

  const executePurchase = async (reference: string | null, fromWallet: boolean) => {
    setPurchaseError(null);
    setPurchaseStage('purchasing');
    setLoading(true);
    try {
      const data = await purchaseNumber({
        provider_code: params.provider_code,
        country_code: params.country_code,
        project_code: params.project_code,
        project_name: params.project_name,
        country_name: params.country_name,
        amount_paid: price,
        ...(fromWallet
          ? { use_wallet: true }
          : { paystack_reference: reference! }
        ),
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshOrders();
      await refreshProfile();

      const orderId = data?.data?.order?.id;
      if (orderId) {
        router.replace({ pathname: '/number-display', params: { order_id: orderId } });
      }
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const parsed = parsePurchaseError(e.message || 'Purchase failed. Please try again.');
      if (e.refunded) {
        const amt = e.refund_amount ?? price;
        parsed.hint = fromWallet
          ? `\u20a6${Number(amt).toLocaleString()} has been returned to your wallet balance.`
          : `Your payment of \u20a6${Number(amt).toLocaleString()} has been refunded to your wallet.`;
      }
      setPurchaseError(parsed);
    } finally {
      setLoading(false);
      setPurchaseStage('idle');
    }
  };

  const handlePay = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPurchaseError(null);

    // ── Wallet-first: skip Paystack entirely if balance covers the price ──
    if (walletBalance >= price) {
      setPurchaseStage('purchasing');
      setLoading(true);
      await executePurchase(null, true);
      setLoading(false);
      setPurchaseStage('idle');
      return;
    }

    // ── Paystack charge via system browser ──
    setPurchaseStage('paying');
    setLoading(true);
    try {
      const data = await initializePayment(user?.email || '', price, 'number_purchase', {
        provider_code: params.provider_code,
        country_code: params.country_code,
        project_code: params.project_code,
        project_name: params.project_name,
        country_name: params.country_name,
        wholesale_cost: wholesalePrice,
      });

      const authUrl = data?.data?.authorization_url;
      const reference = data?.data?.reference;

      if (!authUrl) throw new Error('No payment URL received. Please try again.');

      setLoading(false);
      setPurchaseStage('idle');

      // Open Paystack checkout in system browser sheet
      await WebBrowser.openBrowserAsync(authUrl, {
        dismissButtonStyle: 'close',
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
      });

      // Browser closed — give webhook a moment then execute purchase
      // (webhook may have already processed it server-side; purchaseNumber handles deduplication)
      if (reference) {
        setPurchaseStage('purchasing');
        setLoading(true);
        await new Promise((res) => setTimeout(res, 1500));
        await executePurchase(reference, false);
      } else {
        setPurchaseError({ message: 'Payment reference lost. Contact support.' });
      }
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPurchaseError({ message: e.message || 'Payment initialization failed. Please try again.' });
    } finally {
      setLoading(false);
      setPurchaseStage('idle');
    }
  };

  const payBtnLabel = walletBalance >= price
    ? `Pay \u20a6${price.toLocaleString()} from Wallet`
    : `Pay \u20a6${price.toLocaleString()} via Paystack`;

  const stageLabel = purchaseStage === 'paying'
    ? 'Opening Paystack...'
    : purchaseStage === 'purchasing'
    ? (walletBalance >= price ? 'Paying from wallet...' : 'Securing your number...')
    : null;

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
        <Text style={styles.headerTitle}>Order Summary</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
      >
        {/* ── Wallet balance banner (if sufficient) ── */}
        {walletBalance >= price && (
          <View style={styles.walletBanner}>
            <MaterialIcons name="account-balance-wallet" size={16} color={Colors.primary} />
            <Text style={styles.walletBannerText}>
              Wallet balance: <Text style={styles.walletBannerAmount}>₦{walletBalance.toLocaleString()}</Text> — this purchase will be deducted instantly.
            </Text>
          </View>
        )}

        {/* ── Order card ── */}
        <View style={styles.orderCard}>
          {/* Platform row */}
          <View style={styles.platformRow}>
            <View style={styles.platformIcon}>
              <MaterialIcons
                name={(PLATFORM_ICONS[params.project_name] || 'phone-android') as any}
                size={28}
                color={Colors.primary}
              />
            </View>
            <View style={styles.platformInfo}>
              <Text style={styles.platformName}>{params.project_name}</Text>
              <Text style={styles.platformSub}>{params.country_name} · SMS Verification</Text>
            </View>
            <View style={styles.providerTag}>
              <Text style={styles.providerTagText}>Server B</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Price breakdown */}
          <View style={styles.priceSection}>
            <View style={styles.priceRow}>
              <Text style={styles.priceRowLabel}>Service fee</Text>
              <Text style={styles.priceRowValue}>₦{price.toLocaleString()}</Text>
            </View>
            <View style={[styles.priceRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>₦{price.toLocaleString()}</Text>
            </View>
          </View>
        </View>

        {/* ── Payment methods (only shown when wallet doesn't cover the price) ── */}
        {walletBalance < price && (
          <View style={styles.methodsCard}>
            <Text style={styles.methodsTitle}>Pay with Paystack</Text>
            <View style={styles.methodsList}>
              {[
                { icon: 'credit-card', label: 'Debit / Credit Card' },
                { icon: 'account-balance', label: 'Bank Transfer' },
                { icon: 'smartphone', label: 'USSD' },
              ].map((m) => (
                <View key={m.label} style={styles.methodRow}>
                  <View style={styles.methodIconWrap}>
                    <MaterialIcons name={m.icon as any} size={18} color={Colors.primary} />
                  </View>
                  <Text style={styles.methodLabel}>{m.label}</Text>
                  <MaterialIcons name="check-circle" size={16} color={Colors.primary} style={{ opacity: 0.6 }} />
                </View>
              ))}
            </View>

            {/* Processing fee notice */}
            <View style={styles.feeNotice}>
              <MaterialIcons name="info-outline" size={13} color={Colors.textMuted} />
              <Text style={styles.feeNoticeText}>
                A Paystack processing fee applies and will be shown on the checkout page before you confirm payment.
              </Text>
            </View>

            <View style={styles.secureRow}>
              <MaterialIcons name="lock" size={12} color={Colors.textMuted} />
              <Text style={styles.secureText}>Secured by Paystack · 256-bit TLS encryption</Text>
            </View>
          </View>
        )}

        {/* ── Error banner ── */}
        {purchaseError && (
          <View style={styles.errorBanner}>
            <View style={styles.errorBannerTop}>
              <MaterialIcons name="error-outline" size={18} color={Colors.error} />
              <Text style={styles.errorBannerTitle}>Purchase Failed</Text>
              <TouchableOpacity
                onPress={() => setPurchaseError(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="close" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.errorBannerMsg}>{purchaseError.message}</Text>
            {purchaseError.hint && (
              <Text style={styles.errorBannerHint}>💡 {purchaseError.hint}</Text>
            )}
            <View style={styles.errorActions}>
              <TouchableOpacity
                style={styles.errorActionBack}
                onPress={() => { setPurchaseError(null); router.back(); }}
                activeOpacity={0.8}
              >
                <Text style={styles.errorActionBackText}>Change selection</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.errorActionRetry}
                onPress={() => { setPurchaseError(null); handlePay(); }}
                disabled={loading}
                activeOpacity={0.8}
              >
                <MaterialIcons name="refresh" size={14} color={Colors.black} />
                <Text style={styles.errorActionRetryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Sticky Pay CTA ── */}
      <View style={[styles.ctaBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.payBtn, loading && styles.payBtnDisabled]}
          onPress={handlePay}
          disabled={loading}
          activeOpacity={0.88}
        >
          {loading ? (
            <View style={styles.payBtnLoading}>
              <ActivityIndicator color={Colors.black} />
              {stageLabel && <Text style={styles.payBtnLoadingText}>{stageLabel}</Text>}
            </View>
          ) : (
            <>
              <MaterialIcons name={walletBalance >= price ? 'account-balance-wallet' : 'payment'} size={20} color={Colors.black} />
              <Text style={styles.payBtnText}>{payBtnLabel}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
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
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  content: { padding: Spacing.lg, gap: Spacing.lg },

  // Order card
  orderCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  platformIcon: {
    width: 52, height: 52, borderRadius: Radius.md,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary,
  },
  platformInfo: { flex: 1 },
  platformName: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  platformSub: { color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 2 },
  providerTag: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  providerTagText: { color: Colors.textMuted, fontSize: 10, fontWeight: FontWeight.semibold },
  divider: { height: 1, backgroundColor: Colors.surfaceBorder, marginHorizontal: Spacing.lg },

  priceSection: { padding: Spacing.lg, gap: Spacing.sm },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceRowLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
  priceRowValue: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  totalRow: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  totalLabel: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  totalValue: { color: Colors.primary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },

  // Payment methods
  methodsCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  methodsTitle: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, letterSpacing: 0.5, textTransform: 'uppercase' },
  methodsList: { gap: Spacing.sm },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  methodIconWrap: {
    width: 36, height: 36, borderRadius: Radius.sm,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  methodLabel: { flex: 1, color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  feeNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  feeNoticeText: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  secureText: { color: Colors.textMuted, fontSize: 11 },

  // Wallet banner
  walletBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryMuted,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  walletBannerText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.xs, lineHeight: 18 },
  walletBannerAmount: { color: Colors.primary, fontWeight: FontWeight.bold },

  // Error banner
  errorBanner: {
    backgroundColor: Colors.errorMuted,
    borderWidth: 1,
    borderColor: Colors.error,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  errorBannerTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  errorBannerTitle: { flex: 1, color: Colors.error, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  errorBannerMsg: {
    color: Colors.text, fontSize: FontSize.sm, lineHeight: 20,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.sm, padding: Spacing.md,
    borderLeftWidth: 3, borderLeftColor: Colors.error,
    fontFamily: 'monospace',
  },
  errorBannerHint: { color: Colors.warning, fontSize: FontSize.xs, lineHeight: 18 },
  errorActions: { flexDirection: 'row', gap: Spacing.sm },
  errorActionBack: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md, paddingVertical: 10,
  },
  errorActionBackText: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  errorActionRetry: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, backgroundColor: Colors.error,
    borderRadius: Radius.md, paddingVertical: 10,
  },
  errorActionRetryText: { color: Colors.black, fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  // Pay CTA bar
  ctaBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    height: 56,
  },
  payBtnDisabled: { opacity: 0.6 },
  payBtnText: { color: Colors.black, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  payBtnLoading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  payBtnLoadingText: { color: Colors.black, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
