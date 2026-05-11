import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, TextInput, ActivityIndicator, Modal, FlatList,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/template';
import {
  getProviders, getCountries, getPackages,
  Country, Package,
} from '@/services/sociallyService';
import { PLATFORM_ICONS } from '@/constants/config';
import { Colors, Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

const DEFAULT_PROVIDER = 'server-b';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  // All services loaded from Server B countries endpoint
  const [services, setServices] = useState<Country[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected service → load its packages for price
  const [selectedService, setSelectedService] = useState<Country | null>(null);
  const [servicePackages, setServicePackages] = useState<Package[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);

  // Bottom sheet
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const sheetVisible = !!selectedService;

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    setLoadingServices(true);
    try {
      const data = await getCountries(DEFAULT_PROVIDER);
      setServices(data);
    } catch (e) {
      console.error('Failed to load services:', e);
    } finally {
      setLoadingServices(false);
    }
  };

  const handleServiceTap = async (service: Country) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedService(service);
    setServicePackages([]);
    Animated.spring(sheetAnim, {
      toValue: 1, useNativeDriver: true, tension: 65, friction: 11,
    }).start();
    // Load package details for price
    setLoadingPackages(true);
    try {
      const pkgs = await getPackages(DEFAULT_PROVIDER, service.country_code);
      setServicePackages(pkgs);
    } catch (e) {
      console.error('Failed to load packages for service:', e);
    } finally {
      setLoadingPackages(false);
    }
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, {
      toValue: 0, duration: 220, useNativeDriver: true,
    }).start(() => {
      setSelectedService(null);
      setServicePackages([]);
    });
  };

  const proceedToCheckout = async () => {
    if (!selectedService) return;
    const pkg = servicePackages[0]; // primary package
    if (!pkg) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    closeSheet();
    setTimeout(() => {
      router.push({
        pathname: '/checkout',
        params: {
          provider_code: DEFAULT_PROVIDER,
          country_code: selectedService.country_code,
          country_name: selectedService.title,
          project_code: pkg.project_code,
          project_name: pkg.project_name,
          price: String(pkg.displayPrice),
        },
      });
    }, 250);
  };

  const filteredServices = services.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [500, 0],
  });

  const firstName = user?.username?.split(' ')[0] ||
    user?.email?.split('@')[0] || 'there';

  // Get primary package price for a service card
  const getDisplayPrice = (service: Country) => null; // prices loaded on tap

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

      {/* ── Search bar ── */}
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
        {!loadingServices && (
          <Text style={styles.countBadge}>
            {filteredServices.length} services
          </Text>
        )}
      </View>

      {/* ── Service list ── */}
      {loadingServices ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading available services...</Text>
        </View>
      ) : filteredServices.length === 0 ? (
        <View style={styles.emptyCenter}>
          <View style={styles.emptyIcon}>
            <MaterialIcons name="search-off" size={36} color={Colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No results for "{searchQuery}"</Text>
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear search</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredServices}
          keyExtractor={(item) => item.country_code}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
          showsVerticalScrollIndicator={false}
          numColumns={2}
          columnWrapperStyle={styles.row}
          renderItem={({ item }) => (
            <ServiceCard service={item} onPress={() => handleServiceTap(item)} />
          )}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
        />
      )}

      {/* ══════ Bottom Sheet ══════ */}
      {sheetVisible && (
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={closeSheet}
        />
      )}
      {sheetVisible && (
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
                name={(PLATFORM_ICONS[selectedService?.title?.split(' -')[0] || ''] || 'phone-android') as any}
                size={28}
                color={Colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetServiceName}>{selectedService?.title}</Text>
              <View style={styles.sheetServerTag}>
                <View style={styles.serverDot} />
                <Text style={styles.sheetServerTagText}>Server B · SMS Verification</Text>
              </View>
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
              <Text style={[styles.sheetRowValue, { color: Colors.primary }]}>Auto-refund if no OTP in 5 mins</Text>
            </View>

            {/* Price row */}
            <View style={[styles.sheetRow, styles.sheetPriceRow]}>
              <Text style={styles.sheetPriceLabel}>Total</Text>
              {loadingPackages ? (
                <ActivityIndicator color={Colors.primary} size="small" />
              ) : servicePackages[0] ? (
                <Text style={styles.sheetPrice}>
                  ₦{servicePackages[0].displayPrice.toLocaleString()}
                </Text>
              ) : (
                <Text style={styles.sheetPriceNA}>Price unavailable</Text>
              )}
            </View>
          </View>

          {/* CTA */}
          <TouchableOpacity
            style={[styles.sheetPayBtn, (loadingPackages || !servicePackages[0]) && styles.sheetPayBtnDisabled]}
            onPress={proceedToCheckout}
            disabled={loadingPackages || !servicePackages[0]}
            activeOpacity={0.88}
          >
            {loadingPackages ? (
              <ActivityIndicator color={Colors.black} />
            ) : (
              <>
                <MaterialIcons name="lock" size={16} color={Colors.black} />
                <Text style={styles.sheetPayBtnText}>
                  {servicePackages[0]
                    ? `Pay ₦${servicePackages[0].displayPrice.toLocaleString()}`
                    : 'Loading price...'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.sheetCancelBtn} onPress={closeSheet}>
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}

function ServiceCard({ service, onPress }: { service: Country; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const onPressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true, speed: 30 }).start();
  const onPressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30 }).start();

  // Parse display name: "TikTok - USA" → main = "TikTok", sub = "USA"
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
        <View style={styles.cardIconWrap}>
          <MaterialIcons name={iconName} size={24} color={Colors.primary} />
        </View>
        <Text style={styles.cardName} numberOfLines={2}>{mainName}</Text>
        {subName && <Text style={styles.cardSub} numberOfLines={1}>{subName}</Text>}
        <View style={styles.cardFooter}>
          <Text style={styles.cardBuyLabel}>Get number</Text>
          <MaterialIcons name="arrow-forward" size={13} color={Colors.primary} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

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

  // Search
  searchWrap: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    height: 46,
  },
  searchInput: {
    flex: 1, color: Colors.text,
    fontSize: FontSize.sm, includeFontPadding: false,
  },
  countBadge: { color: Colors.textMuted, fontSize: 11, marginLeft: 4 },

  // States
  loadingCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
  },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.sm },
  emptyCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold, textAlign: 'center' },
  clearBtn: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: 10,
  },
  clearBtnText: { color: Colors.textSecondary, fontSize: FontSize.sm },

  // FlatList
  listContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  row: { gap: Spacing.md },

  // Service card
  cardWrap: { flex: 1 },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 8,
    minHeight: 130,
  },
  cardIconWrap: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,200,83,0.2)',
  },
  cardName: {
    color: Colors.text, fontSize: FontSize.sm,
    fontWeight: FontWeight.bold, lineHeight: 18,
  },
  cardSub: { color: Colors.textMuted, fontSize: 11 },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 'auto' as any,
  },
  cardBuyLabel: { color: Colors.primary, fontSize: 11, fontWeight: FontWeight.semibold },

  // Backdrop
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
  },

  // Bottom sheet
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
    width: 56, height: 56, borderRadius: Radius.md,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary,
  },
  sheetServiceName: {
    color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold,
  },
  sheetServerTag: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  sheetServerTagText: { color: Colors.textSecondary, fontSize: FontSize.xs },

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
  sheetPriceNA: { color: Colors.textMuted, fontSize: FontSize.sm, fontStyle: 'italic' },

  sheetPayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.md, height: 54,
    marginBottom: Spacing.sm,
  },
  sheetPayBtnDisabled: { opacity: 0.5 },
  sheetPayBtnText: { color: Colors.black, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  sheetCancelBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  sheetCancelText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
