import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, TextInput, ActivityIndicator,
  Animated, RefreshControl, FlatList,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/template';
import {
  getServicesWithPrices, ServiceItem, ServiceCategory,
} from '@/services/sociallyService';
import { PLATFORM_ICONS } from '@/constants/config';
import { Colors, Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

const DEFAULT_PROVIDER = 'server-b';

const CATEGORIES: ServiceCategory[] = ['All', 'Social', 'Messaging', 'Finance', 'Shopping', 'Other'];

const CATEGORY_ICONS: Record<ServiceCategory, string> = {
  All: 'apps',
  Social: 'people',
  Messaging: 'chat-bubble',
  Finance: 'account-balance-wallet',
  Shopping: 'shopping-cart',
  Other: 'more-horiz',
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [allServices, setAllServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<ServiceCategory>('All');
  const [loadProgress, setLoadProgress] = useState(0);

  // Bottom sheet
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else { setLoading(true); setLoadProgress(0); }

    try {
      // Progress animation while loading
      const progressTimer = setInterval(() => {
        setLoadProgress((p) => Math.min(p + 0.04, 0.85));
      }, 400);

      const items = await getServicesWithPrices(DEFAULT_PROVIDER);

      clearInterval(progressTimer);
      setLoadProgress(1);
      setAllServices(items);
    } catch (e) {
      console.error('Failed to load services:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => loadServices(true);

  // ── Filtered list ──
  const filteredServices = allServices.filter((s) => {
    const matchesSearch = s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.country_code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === 'All' || s.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // Category counts
  const categoryCounts = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = cat === 'All'
      ? allServices.length
      : allServices.filter((s) => s.category === cat).length;
    return acc;
  }, {} as Record<ServiceCategory, number>);

  // ── Bottom sheet ──
  const openSheet = async (service: ServiceItem) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedService(service);
    Animated.spring(sheetAnim, {
      toValue: 1, useNativeDriver: true, tension: 65, friction: 11,
    }).start();
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, {
      toValue: 0, duration: 220, useNativeDriver: true,
    }).start(() => setSelectedService(null));
  };

  const proceedToCheckout = async () => {
    if (!selectedService) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const svc = selectedService;
    closeSheet();
    setTimeout(() => {
      router.push({
        pathname: '/checkout',
        params: {
          provider_code: DEFAULT_PROVIDER,
          country_code: svc.country_code,
          country_name: svc.title,
          project_code: svc.package.project_code,
          project_name: svc.package.project_name,
          price: String(svc.package.displayPrice),
        },
      });
    }, 250);
  };

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1], outputRange: [600, 0],
  });

  const firstName = user?.username?.split(' ')[0] ||
    user?.email?.split('@')[0] || 'there';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hey, {firstName} 👋</Text>
          <Text style={styles.tagline}>Pick a service, get your number.</Text>
        </View>
        <View style={styles.serverBadge}>
          <View style={styles.serverDot} />
          <Text style={styles.serverText}>SERVER B</Text>
        </View>
      </View>

      {/* ── Search ── */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <MaterialIcons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search TikTok, WhatsApp, PayPal..."
            placeholderTextColor={Colors.textMuted}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="close" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Loading state ── */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <View style={styles.loadingCard}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={styles.loadingTitle}>Loading services...</Text>
            <Text style={styles.loadingSubtitle}>Fetching available prices from Server B</Text>
            {/* Progress bar */}
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: `${Math.round(loadProgress * 100)}%` }]} />
            </View>
            <Text style={styles.progressLabel}>
              {loadProgress < 1
                ? `${Math.round(loadProgress * 100)}% — filtering unavailable services...`
                : 'Almost done...'}
            </Text>
          </View>
        </View>
      ) : (
        <>
          {/* ── Category chips ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRow}
          >
            {CATEGORIES.filter((cat) => categoryCounts[cat] > 0 || cat === 'All').map((cat) => {
              const active = activeCategory === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={async () => {
                    await Haptics.selectionAsync();
                    setActiveCategory(cat);
                  }}
                  activeOpacity={0.8}
                >
                  <MaterialIcons
                    name={CATEGORY_ICONS[cat] as any}
                    size={14}
                    color={active ? Colors.black : Colors.textSecondary}
                  />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{cat}</Text>
                  <View style={[styles.chipCount, active && styles.chipCountActive]}>
                    <Text style={[styles.chipCountText, active && styles.chipCountTextActive]}>
                      {categoryCounts[cat]}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* ── Service grid ── */}
          {filteredServices.length === 0 ? (
            <View style={styles.emptyCenter}>
              <View style={styles.emptyIcon}>
                <MaterialIcons name="search-off" size={32} color={Colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No results</Text>
              <Text style={styles.emptySub}>
                {searchQuery ? `No services match "${searchQuery}"` : `No services in ${activeCategory} category`}
              </Text>
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => { setSearchQuery(''); setActiveCategory('All'); }}
              >
                <Text style={styles.clearBtnText}>Clear filters</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={filteredServices}
              keyExtractor={(item) => item.country_code}
              numColumns={2}
              columnWrapperStyle={styles.row}
              contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 32 }]}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={Colors.primary}
                  colors={[Colors.primary]}
                />
              }
              ListHeaderComponent={
                <Text style={styles.resultsCount}>
                  {filteredServices.length} {activeCategory !== 'All' ? activeCategory + ' ' : ''}service{filteredServices.length !== 1 ? 's' : ''}
                </Text>
              }
              renderItem={({ item }) => (
                <ServiceCard service={item} onPress={() => openSheet(item)} />
              )}
            />
          )}
        </>
      )}

      {/* ══════ Bottom Sheet ══════ */}
      {!!selectedService && (
        <>
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={closeSheet}
          />
          <Animated.View
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + 24, transform: [{ translateY: sheetTranslateY }] },
            ]}
          >
            <View style={styles.sheetHandle} />

            {/* Service identity */}
            <View style={styles.sheetServiceRow}>
              <View style={styles.sheetServiceIcon}>
                <MaterialIcons
                  name={(PLATFORM_ICONS[selectedService.title.split(' -')[0]?.trim()] || 'phone-android') as any}
                  size={26}
                  color={Colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetServiceName} numberOfLines={2}>
                  {selectedService.title}
                </Text>
                <View style={styles.sheetServerTag}>
                  <View style={styles.serverDot} />
                  <Text style={styles.sheetServerTagText}>Server B · {selectedService.category}</Text>
                </View>
              </View>
              {/* Category pill */}
              <View style={styles.sheetCatPill}>
                <MaterialIcons name={CATEGORY_ICONS[selectedService.category] as any} size={11} color={Colors.primary} />
                <Text style={styles.sheetCatText}>{selectedService.category}</Text>
              </View>
            </View>

            {/* Order details */}
            <View style={styles.sheetDetails}>
              <View style={styles.sheetRow}>
                <Text style={styles.sheetRowLabel}>You receive</Text>
                <Text style={styles.sheetRowValue}>Real temporary phone number</Text>
              </View>
              <View style={styles.sheetRow}>
                <Text style={styles.sheetRowLabel}>OTP delivery</Text>
                <Text style={styles.sheetRowValue}>Auto-captured instantly</Text>
              </View>
              <View style={styles.sheetRow}>
                <Text style={styles.sheetRowLabel}>Refund policy</Text>
                <Text style={[styles.sheetRowValue, { color: Colors.primary }]}>
                  Auto-refund if no OTP in 5 mins
                </Text>
              </View>
              {/* Price — always pre-loaded, no spinner */}
              <View style={[styles.sheetRow, styles.sheetPriceRow]}>
                <Text style={styles.sheetPriceLabel}>Total</Text>
                <Text style={styles.sheetPrice}>
                  ₦{selectedService.package.displayPrice.toLocaleString()}
                </Text>
              </View>
            </View>

            {/* CTA */}
            <TouchableOpacity
              style={styles.sheetPayBtn}
              onPress={proceedToCheckout}
              activeOpacity={0.88}
            >
              <MaterialIcons name="lock" size={16} color={Colors.black} />
              <Text style={styles.sheetPayBtnText}>
                Pay ₦{selectedService.package.displayPrice.toLocaleString()}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetCancelBtn} onPress={closeSheet}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        </>
      )}
    </View>
  );
}

// ── Service Card ─────────────────────────────────────────────────────────────

function ServiceCard({ service, onPress }: { service: ServiceItem; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const onPressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true, speed: 30 }).start();
  const onPressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30 }).start();

  const parts = service.title.split(' - ');
  const mainName = parts[0]?.trim() || service.title;
  const subName = parts[1]?.trim() || null;
  const iconName = (PLATFORM_ICONS[mainName] || 'phone-android') as any;

  return (
    <Animated.View style={[styles.cardWrap, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        activeOpacity={1}
      >
        <View style={styles.cardTop}>
          <View style={styles.cardIconWrap}>
            <MaterialIcons name={iconName} size={22} color={Colors.primary} />
          </View>
          {/* Category micro-tag */}
          <View style={styles.cardCatTag}>
            <Text style={styles.cardCatTagText}>{service.category}</Text>
          </View>
        </View>

        <Text style={styles.cardName} numberOfLines={2}>{mainName}</Text>
        {subName && <Text style={styles.cardSub} numberOfLines={1}>{subName}</Text>}

        {/* Price — always shown, pre-loaded */}
        <Text style={styles.cardPrice}>
          ₦{service.package.displayPrice.toLocaleString()}
        </Text>

        <View style={styles.cardFooter}>
          <Text style={styles.cardBuyLabel}>Get number</Text>
          <MaterialIcons name="arrow-forward" size={13} color={Colors.primary} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  greeting: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  tagline: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 2 },
  serverBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  serverDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.primary },
  serverText: { color: Colors.textSecondary, fontSize: 11, fontWeight: FontWeight.semibold },

  searchWrap: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    height: 46,
  },
  searchInput: {
    flex: 1, color: Colors.text, fontSize: FontSize.sm, includeFontPadding: false,
  },

  // Loading
  loadingContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg,
  },
  loadingCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
    width: '100%',
  },
  loadingTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  loadingSubtitle: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center' },
  progressTrack: {
    height: 6, width: '100%',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
  },
  progressLabel: { color: Colors.textMuted, fontSize: 11, textAlign: 'center' },

  // Category chips
  categoryRow: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: FontWeight.medium },
  chipTextActive: { color: Colors.black },
  chipCount: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.full,
    paddingHorizontal: 5, paddingVertical: 1,
    minWidth: 20, alignItems: 'center',
  },
  chipCountActive: { backgroundColor: 'rgba(0,0,0,0.2)' },
  chipCountText: { color: Colors.textMuted, fontSize: 10, fontWeight: FontWeight.bold },
  chipCountTextActive: { color: Colors.black },

  // Results count
  resultsCount: {
    color: Colors.textMuted,
    fontSize: 11,
    marginBottom: Spacing.sm,
    marginLeft: 2,
  },

  // Empty
  emptyCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  emptySub: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center' },
  clearBtn: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: 10,
  },
  clearBtnText: { color: Colors.textSecondary, fontSize: FontSize.sm },

  // List
  listContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs },
  row: { gap: Spacing.md, marginBottom: Spacing.md },

  // Card
  cardWrap: { flex: 1 },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 6,
    minHeight: 145,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardIconWrap: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,200,83,0.2)',
  },
  cardCatTag: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.full,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  cardCatTagText: { color: Colors.textMuted, fontSize: 9, fontWeight: FontWeight.semibold },
  cardName: {
    color: Colors.text, fontSize: FontSize.sm,
    fontWeight: FontWeight.bold, lineHeight: 18,
  },
  cardSub: { color: Colors.textMuted, fontSize: 10 },
  cardPrice: {
    color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.bold,
  },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 'auto' as any,
  },
  cardBuyLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: FontWeight.medium },

  // Backdrop
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
  },

  // Sheet
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    borderTopWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing.lg, paddingTop: Spacing.md,
    shadowColor: '#000', shadowOpacity: 0.5,
    shadowRadius: 24, shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    alignSelf: 'center', marginBottom: Spacing.lg,
  },
  sheetServiceRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: Spacing.md, marginBottom: Spacing.lg,
  },
  sheetServiceIcon: {
    width: 52, height: 52, borderRadius: Radius.md,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary,
    flexShrink: 0,
  },
  sheetServiceName: {
    color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold, lineHeight: 24,
  },
  sheetServerTag: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  sheetServerTagText: { color: Colors.textSecondary, fontSize: FontSize.xs },
  sheetCatPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primaryMuted,
    borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(0,200,83,0.2)',
    flexShrink: 0,
  },
  sheetCatText: { color: Colors.primary, fontSize: 10, fontWeight: FontWeight.semibold },

  sheetDetails: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.md, marginBottom: Spacing.lg,
  },
  sheetRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  sheetPriceRow: { borderBottomWidth: 0 },
  sheetRowLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
  sheetRowValue: {
    color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.medium,
    flex: 1, textAlign: 'right',
  },
  sheetPriceLabel: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  sheetPrice: { color: Colors.primary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },

  sheetPayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.md, height: 54,
    marginBottom: Spacing.sm,
  },
  sheetPayBtnText: { color: Colors.black, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  sheetCancelBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  sheetCancelText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
