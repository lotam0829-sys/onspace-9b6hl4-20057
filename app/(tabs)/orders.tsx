import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/template';
import { useOrders } from '@/hooks/useOrders';
import { Colors, Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

const STATUS_COLORS = {
  pending: Colors.warning,
  completed: Colors.success,
  expired: Colors.error,
};

const STATUS_ICONS = {
  pending: 'schedule',
  completed: 'check-circle',
  expired: 'cancel',
};

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { orders, loading, refreshOrders } = useOrders();
  const { user } = useAuth();

  useEffect(() => {
    if (user) refreshOrders();
  }, [user]);

  const handleOrderPress = async (orderId: string) => {
    await Haptics.selectionAsync();
    router.push({ pathname: '/number-display', params: { order_id: orderId } });
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-NG', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Orders</Text>
        <TouchableOpacity
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            refreshOrders();
          }}
          style={styles.refreshBtn}
        >
          <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.empty}>
          <MaterialIcons name="receipt-long" size={56} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No Orders Yet</Text>
          <Text style={styles.emptyText}>Your purchased verification numbers will appear here</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: Spacing.lg }}
        >
          {orders.map((order) => (
            <TouchableOpacity
              key={order.id}
              style={styles.orderCard}
              onPress={() => handleOrderPress(order.id)}
              activeOpacity={0.8}
            >
              <View style={styles.orderTop}>
                <View style={styles.orderLeft}>
                  <View style={styles.orderIcon}>
                    <MaterialIcons name="phone-android" size={20} color={Colors.primary} />
                  </View>
                  <View style={styles.orderMeta}>
                    <Text style={styles.orderProject}>{order.project_name}</Text>
                    <Text style={styles.orderCountry}>{order.country_name}</Text>
                    <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
                  </View>
                </View>
                <View style={styles.orderRight}>
                  <View style={[styles.statusBadge, { backgroundColor: `${STATUS_COLORS[order.status]}20` }]}>
                    <MaterialIcons
                      name={STATUS_ICONS[order.status] as any}
                      size={12}
                      color={STATUS_COLORS[order.status]}
                    />
                    <Text style={[styles.statusText, { color: STATUS_COLORS[order.status] }]}>
                      {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={18} color={Colors.textMuted} />
                </View>
              </View>

              {/* Amount + OTP preview row */}
              <View style={styles.orderFooter}>
                <Text style={styles.orderAmount}>
                  ₦{Number(order.amount_paid).toLocaleString()}
                </Text>
                {order.otp ? (
                  <View style={styles.otpPreview}>
                    <MaterialIcons name="sms" size={12} color={Colors.success} />
                    <Text style={styles.otpPreviewText}>OTP received</Text>
                  </View>
                ) : order.status === 'pending' ? (
                  <View style={styles.otpPreview}>
                    <ActivityIndicator size={10} color={Colors.warning} />
                    <Text style={[styles.otpPreviewText, { color: Colors.warning }]}>Awaiting OTP</Text>
                  </View>
                ) : (
                  <View style={styles.otpPreview}>
                    <MaterialIcons name="info-outline" size={12} color={Colors.textMuted} />
                    <Text style={[styles.otpPreviewText, { color: Colors.textMuted }]}>Tap to view</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
          <View style={{ height: 20 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
  },
  refreshBtn: {
    padding: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 22,
  },
  orderCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  orderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  orderIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  orderMeta: { flex: 1, gap: 2 },
  orderProject: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  orderCountry: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
  },
  orderDate: {
    color: Colors.textMuted,
    fontSize: 10,
  },
  orderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 0 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: { fontSize: 11, fontWeight: FontWeight.semibold },
  orderFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  orderAmount: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  otpPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  otpPreviewText: {
    color: Colors.success,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
  },
});
