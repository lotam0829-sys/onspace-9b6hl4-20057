import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator, TextInput,
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

type StatusFilter = 'all' | 'pending' | 'completed' | 'expired';

const STATUS_FILTER_LABELS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
  { key: 'expired', label: 'Expired' },
];

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { orders, loading, refreshOrders } = useOrders();
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [serviceSearch, setServiceSearch] = useState('');

  useEffect(() => {
    if (user) refreshOrders();
  }, [user]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchStatus = statusFilter === 'all' || o.status === statusFilter;
      const matchService = !serviceSearch.trim() ||
        o.project_name.toLowerCase().includes(serviceSearch.toLowerCase()) ||
        o.country_name.toLowerCase().includes(serviceSearch.toLowerCase());
      return matchStatus && matchService;
    });
  }, [orders, statusFilter, serviceSearch]);

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

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <MaterialIcons name="search" size={16} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={serviceSearch}
          onChangeText={setServiceSearch}
          placeholder="Search by service or country..."
          placeholderTextColor={Colors.textMuted}
        />
        {serviceSearch.length > 0 && (
          <TouchableOpacity onPress={() => setServiceSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {STATUS_FILTER_LABELS.map(({ key, label }) => {
          const count = key === 'all' ? orders.length : orders.filter((o) => o.status === key).length;
          const active = statusFilter === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.chip, active && styles.chipActive, key !== 'all' && { borderColor: `${STATUS_COLORS[key as keyof typeof STATUS_COLORS]}40` }]}
              onPress={async () => {
                await Haptics.selectionAsync();
                setStatusFilter(key);
              }}
              activeOpacity={0.8}
            >
              {key !== 'all' && (
                <MaterialIcons
                  name={STATUS_ICONS[key as keyof typeof STATUS_ICONS] as any}
                  size={12}
                  color={active ? '#fff' : STATUS_COLORS[key as keyof typeof STATUS_COLORS]}
                />
              )}
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
              <View style={[styles.chipBadge, active && styles.chipBadgeActive]}>
                <Text style={[styles.chipBadgeText, active && styles.chipBadgeTextActive]}>{count}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : filteredOrders.length === 0 ? (
        <View style={styles.empty}>
          <MaterialIcons name="receipt-long" size={56} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>
            {orders.length === 0 ? 'No Orders Yet' : 'No matches'}
          </Text>
          <Text style={styles.emptyText}>
            {orders.length === 0
              ? 'Your purchased verification numbers will appear here'
              : 'Try a different status or clear the search'}
          </Text>
          {orders.length > 0 && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => { setStatusFilter('all'); setServiceSearch(''); }}
            >
              <Text style={styles.clearBtnText}>Clear filters</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: Spacing.lg }}
        >
          {filteredOrders.map((order) => (
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

  // Search bar
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    height: 42,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: FontSize.sm,
    includeFontPadding: false,
  },

  // Filter chips
  chipRow: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 34,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: FontWeight.semibold },
  chipTextActive: { color: Colors.black, fontWeight: FontWeight.bold },
  chipBadge: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.full,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
  },
  chipBadgeActive: { backgroundColor: 'rgba(0,0,0,0.20)' },
  chipBadgeText: { color: Colors.textMuted, fontSize: 10, fontWeight: FontWeight.bold },
  chipBadgeTextActive: { color: Colors.black },

  // Clear filter button
  clearBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  clearBtnText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
