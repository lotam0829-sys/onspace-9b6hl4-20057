import React, { useEffect, useState } from 'react';
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
import { Order } from '@/services/orderService';
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
  const { orders, loading, refreshOrders } = useOrders();
  const [expanded, setExpanded] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (user) refreshOrders();
  }, [user]);

  const toggleExpand = async (id: string) => {
    await Haptics.selectionAsync();
    setExpanded(prev => prev === id ? null : id);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: Spacing.lg }}>
          {orders.map((order) => (
            <TouchableOpacity
              key={order.id}
              style={styles.orderCard}
              onPress={() => toggleExpand(order.id)}
              activeOpacity={0.8}
            >
              <View style={styles.orderTop}>
                <View style={styles.orderLeft}>
                  <View style={styles.orderIcon}>
                    <MaterialIcons name="phone-android" size={20} color={Colors.primary} />
                  </View>
                  <View>
                    <Text style={styles.orderProject}>{order.project_name}</Text>
                    <Text style={styles.orderCountry}>{order.country_name}</Text>
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
                  <MaterialIcons
                    name={expanded === order.id ? "expand-less" : "expand-more"}
                    size={20}
                    color={Colors.textMuted}
                  />
                </View>
              </View>

              {expanded === order.id && (
                <View style={styles.orderDetails}>
                  <View style={styles.detailDivider} />

                  <DetailRow label="Phone Number" value={order.phone_number || "—"} copyable />
                  {order.otp ? (
                    <DetailRow label="OTP Code" value={order.otp} copyable highlight />
                  ) : (
                    <DetailRow label="OTP Code" value={order.status === 'expired' ? "Not received" : "Waiting..."} />
                  )}
                  <DetailRow label="Amount Paid" value={`₦${Number(order.amount_paid).toLocaleString()}`} />
                  <DetailRow label="Date" value={formatDate(order.created_at)} />
                  {order.order_reference && (
                    <DetailRow label="Reference" value={order.order_reference} />
                  )}
                </View>
              )}
            </TouchableOpacity>
          ))}
          <View style={{ height: 20 }} />
        </ScrollView>
      )}
    </View>
  );
}

function DetailRow({ label, value, copyable, highlight }: {
  label: string; value: string; copyable?: boolean; highlight?: boolean;
}) {
  const handleCopy = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Copy to clipboard
  };

  return (
    <View style={detailStyles.row}>
      <Text style={detailStyles.label}>{label}</Text>
      <View style={detailStyles.valueRow}>
        <Text style={[detailStyles.value, highlight && detailStyles.valueHighlight]}>
          {value}
        </Text>
        {copyable && value !== "—" && value !== "Waiting..." && (
          <TouchableOpacity onPress={handleCopy} style={detailStyles.copyBtn}>
            <MaterialIcons name="content-copy" size={14} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  label: { color: Colors.textSecondary, fontSize: FontSize.sm },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  valueHighlight: { color: Colors.primary, fontWeight: FontWeight.bold, fontSize: FontSize.md },
  copyBtn: { padding: 4 },
});

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
  },
  orderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  orderIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderProject: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  orderCountry: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
  },
  orderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: { fontSize: 11, fontWeight: FontWeight.semibold },
  orderDetails: { marginTop: Spacing.sm },
  detailDivider: {
    height: 1,
    backgroundColor: Colors.surfaceBorder,
    marginBottom: Spacing.sm,
  },
});
