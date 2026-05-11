import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, TextInput, ActivityIndicator, Modal,
  Animated, Dimensions, FlatList,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/template';
import {
  getProviders, getCountries, getPackages,
  Provider, Country, Package,
} from '@/services/sociallyService';
import { PLATFORM_ICONS } from '@/constants/config';
import { Colors, Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DEFAULT_PROVIDER = 'server-b';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [searchPlatform, setSearchPlatform] = useState('');
  const [searchCountry, setSearchCountry] = useState('');

  const [loadingCountries, setLoadingCountries] = useState(false);
  const [loadingPackages, setLoadingPackages] = useState(false);

  // Country picker modal
  const [countryModalVisible, setCountryModalVisible] = useState(false);

  // Platform confirm bottom sheet
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    initProviders();
  }, []);

  const initProviders = async () => {
    try {
      const data = await getProviders();
      const serverB = data.find((p) => p.provider_code === DEFAULT_PROVIDER) || data[0];
      if (serverB) {
        setSelectedProvider(serverB);
        loadCountries(serverB.provider_code);
      }
    } catch (e) {
      console.error('Failed to load providers:', e);
    }
  };

  const loadCountries = async (providerCode: string) => {
    setLoadingCountries(true);
    try {
      const data = await getCountries(providerCode);
      setCountries(data);
    } catch (e) {
      console.error('Failed to load countries:', e);
    } finally {
      setLoadingCountries(false);
    }
  };

  const loadPackages = async (country: Country) => {
    if (!selectedProvider) return;
    setLoadingPackages(true);
    setPackages([]);
    try {
      const data = await getPackages(selectedProvider.provider_code, country.country_code);
      setPackages(data);
    } catch (e) {
      console.error('Failed to load packages:', e);
    } finally {
      setLoadingPackages(false);
    }
  };

  const handleCountrySelect = async (country: Country) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCountry(country);
    setCountryModalVisible(false);
    setSearchCountry('');
    setPackages([]);
    loadPackages(country);
  };

  const handlePackageTap = async (pkg: Package) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedPackage(pkg);
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() =>
      setSelectedPackage(null)
    );
  };

  const proceedToCheckout = async () => {
    if (!selectedPackage || !selectedCountry || !selectedProvider) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    closeSheet();
    setTimeout(() => {
      router.push({
        pathname: '/checkout',
        params: {
          provider_code: selectedProvider.provider_code,
          country_code: String(selectedCountry.country_code),
          country_name: selectedCountry.title,
          project_code: selectedPackage.project_code,
          project_name: selectedPackage.project_name,
          price: String(selectedPackage.displayPrice),
        },
      });
    }, 250);
  };

  const filteredCountries = countries.filter((c) =>
    c.title.toLowerCase().includes(searchCountry.toLowerCase())
  );

  const filteredPackages = packages.filter((p) =>
    p.project_name.toLowerCase().includes(searchPlatform.toLowerCase())
  );

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  const firstName = user?.username?.split(' ')[0] || user?.email?.split('@')[0] || 'there';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hey, {firstName} 👋</Text>
          <Text style={styles.appTagline}>Get a number, get verified.</Text>
        </View>
        <View style={styles.providerPill}>
          <View style={styles.providerDot} />
          <Text style={styles.providerPillText}>SERVER B</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>

        {/* ── Country Selector Card ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>STEP 1 — SELECT COUNTRY</Text>
          <TouchableOpacity
            style={styles.countryCard}
            onPress={async () => {
              await Haptics.selectionAsync();
              setCountryModalVisible(true);
            }}
            activeOpacity={0.8}
          >
            {selectedCountry ? (
              <>
                <View style={styles.countryCardLeft}>
                  <View style={styles.countryFlagCircle}>
                    <Text style={styles.countryFlagEmoji}>🌍</Text>
                  </View>
                  <View>
                    <Text style={styles.countryCardName}>{selectedCountry.title}</Text>
                    <Text style={styles.countryCardSub}>
                      {packages.length > 0
                        ? `${packages.length} platforms available`
                        : loadingPackages
                        ? 'Loading platforms...'
                        : 'Tap to change'}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="edit" size={18} color={Colors.primary} />
              </>
            ) : (
              <>
                <View style={styles.countryCardLeft}>
                  <View style={[styles.countryFlagCircle, styles.countryFlagEmpty]}>
                    <MaterialIcons name="public" size={22} color={Colors.textMuted} />
                  </View>
                  <View>
                    <Text style={styles.countryCardPlaceholder}>Choose a country</Text>
                    <Text style={styles.countryCardSub}>200+ countries available</Text>
                  </View>
                </View>
                <MaterialIcons name="chevron-right" size={20} color={Colors.textMuted} />
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Platform Grid ── */}
        <View style={styles.section}>
          <View style={styles.platformsHeader}>
            <Text style={styles.sectionLabel}>STEP 2 — CHOOSE PLATFORM</Text>
            {selectedCountry && !loadingPackages && packages.length > 0 && (
              <Text style={styles.platformCount}>{packages.length} available</Text>
            )}
          </View>

          {!selectedCountry ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconRing}>
                <MaterialIcons name="touch-app" size={32} color={Colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>Select a country first</Text>
              <Text style={styles.emptyBody}>
                Pick a country above to see all available platforms and their prices.
              </Text>
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={async () => {
                  await Haptics.selectionAsync();
                  setCountryModalVisible(true);
                }}
                activeOpacity={0.85}
              >
                <MaterialIcons name="public" size={16} color={Colors.black} />
                <Text style={styles.emptyBtnText}>Pick a Country</Text>
              </TouchableOpacity>
            </View>
          ) : loadingPackages ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={Colors.primary} size="large" />
              <Text style={styles.loadingText}>Finding available platforms...</Text>
            </View>
          ) : filteredPackages.length === 0 && searchPlatform.length > 0 ? (
            <Text style={styles.noResultText}>No platform found for "{searchPlatform}"</Text>
          ) : packages.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="info-outline" size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No platforms available</Text>
              <Text style={styles.emptyBody}>Try selecting a different country.</Text>
            </View>
          ) : (
            <>
              {/* Search platforms */}
              <View style={styles.searchBar}>
                <MaterialIcons name="search" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={searchPlatform}
                  onChangeText={setSearchPlatform}
                  placeholder="Search TikTok, PayPal..."
                  placeholderTextColor={Colors.textMuted}
                />
                {searchPlatform.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchPlatform('')}>
                    <MaterialIcons name="close" size={14} color={Colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.packageGrid}>
                {filteredPackages.map((pkg) => (
                  <PackageCard key={pkg.project_code} pkg={pkg} onPress={() => handlePackageTap(pkg)} />
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* ══════════════════════════════════════
          Country Picker Modal
      ══════════════════════════════════════ */}
      <Modal
        visible={countryModalVisible}
        animationType="slide"
        onRequestClose={() => { setCountryModalVisible(false); setSearchCountry(''); }}
      >
        <View style={[styles.countryModal, { paddingTop: insets.top }]}>
          {/* Modal header */}
          <View style={styles.countryModalHeader}>
            <TouchableOpacity
              onPress={() => { setCountryModalVisible(false); setSearchCountry(''); }}
              style={styles.modalCloseBtn}
            >
              <MaterialIcons name="close" size={20} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.countryModalTitle}>Select Country</Text>
            <View style={{ width: 36 }} />
          </View>

          {/* Search */}
          <View style={styles.countrySearchBar}>
            <MaterialIcons name="search" size={18} color={Colors.textMuted} />
            <TextInput
              style={styles.countrySearchInput}
              value={searchCountry}
              onChangeText={setSearchCountry}
              placeholder="Search countries..."
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            {searchCountry.length > 0 && (
              <TouchableOpacity onPress={() => setSearchCountry('')}>
                <MaterialIcons name="close" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Country list */}
          {loadingCountries ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={filteredCountries}
              keyExtractor={(item) => String(item.country_code)}
              contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: insets.bottom + 24 }}
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: Colors.surfaceBorder }} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.countryRow}
                  onPress={() => handleCountrySelect(item)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.countryRowFlag}>🌍</Text>
                  <Text style={styles.countryRowName}>{item.title}</Text>
                  {selectedCountry?.country_code === item.country_code && (
                    <MaterialIcons name="check-circle" size={18} color={Colors.primary} />
                  )}
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>

      {/* ══════════════════════════════════════
          Platform Confirm Bottom Sheet
      ══════════════════════════════════════ */}
      {selectedPackage && (
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={closeSheet}
        />
      )}
      {selectedPackage && (
        <Animated.View
          style={[
            styles.confirmSheet,
            { paddingBottom: insets.bottom + 24, transform: [{ translateY: sheetTranslateY }] },
          ]}
        >
          <View style={styles.sheetHandle} />

          {/* Platform icon + name */}
          <View style={styles.sheetPlatformRow}>
            <View style={styles.sheetPlatformIcon}>
              <MaterialIcons
                name={(PLATFORM_ICONS[selectedPackage.project_name] || 'phone-android') as any}
                size={30}
                color={Colors.primary}
              />
            </View>
            <View style={styles.sheetPlatformInfo}>
              <Text style={styles.sheetPlatformName}>{selectedPackage.project_name}</Text>
              <Text style={styles.sheetPlatformSub}>
                {selectedCountry?.title} · SMS Verification
              </Text>
            </View>
          </View>

          {/* Order details */}
          <View style={styles.sheetDetails}>
            <View style={styles.sheetDetailRow}>
              <Text style={styles.sheetDetailLabel}>You receive</Text>
              <Text style={styles.sheetDetailValue}>Real temporary phone number</Text>
            </View>
            <View style={styles.sheetDetailRow}>
              <Text style={styles.sheetDetailLabel}>OTP delivery</Text>
              <Text style={styles.sheetDetailValue}>Auto-captured · shown instantly</Text>
            </View>
            <View style={styles.sheetDetailRow}>
              <Text style={styles.sheetDetailLabel}>Refund if no OTP</Text>
              <Text style={[styles.sheetDetailValue, { color: Colors.primary }]}>Automatic within 5 mins</Text>
            </View>
            <View style={[styles.sheetDetailRow, styles.sheetPriceRow]}>
              <Text style={styles.sheetPriceLabel}>Total</Text>
              <Text style={styles.sheetPrice}>₦{selectedPackage.displayPrice.toLocaleString()}</Text>
            </View>
          </View>

          {/* Payment CTA */}
          <TouchableOpacity style={styles.sheetPayBtn} onPress={proceedToCheckout} activeOpacity={0.88}>
            <MaterialIcons name="lock" size={16} color={Colors.black} />
            <Text style={styles.sheetPayBtnText}>Pay ₦{selectedPackage.displayPrice.toLocaleString()}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.sheetCancelBtn} onPress={closeSheet}>
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}

function PackageCard({ pkg, onPress }: { pkg: Package; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const onPressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.96, useNativeDriver: true, speed: 30 }).start();
  const onPressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30 }).start();

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }], width: '47%' }}>
      <TouchableOpacity
        style={styles.packageCard}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        activeOpacity={1}
      >
        <View style={styles.packageIconWrap}>
          <MaterialIcons
            name={(PLATFORM_ICONS[pkg.project_name] || 'phone-android') as any}
            size={22}
            color={Colors.primary}
          />
        </View>
        <Text style={styles.packageName} numberOfLines={2}>{pkg.project_name}</Text>
        <View style={styles.packagePriceRow}>
          <Text style={styles.packagePrice}>₦{pkg.displayPrice.toLocaleString()}</Text>
          <MaterialIcons name="arrow-forward" size={13} color={Colors.primary} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  greeting: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  appTagline: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 2 },
  providerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  providerDot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  providerPillText: { color: Colors.textSecondary, fontSize: 11, fontWeight: FontWeight.semibold },

  // Section
  section: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.lg },
  sectionLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.2,
    marginBottom: Spacing.sm,
  },
  platformsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  platformCount: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },

  // Country selector card
  countryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    shadowColor: Colors.primary,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  countryCardLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  countryFlagCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  countryFlagEmpty: { backgroundColor: Colors.surfaceElevated },
  countryFlagEmoji: { fontSize: 22 },
  countryCardName: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  countryCardPlaceholder: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  countryCardSub: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 2 },

  // Platform search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    height: 40,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  searchInput: { flex: 1, color: Colors.text, fontSize: FontSize.sm, includeFontPadding: false },

  // Package grid
  packageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  packageCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  packageIconWrap: {
    width: 40, height: 40,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  packageName: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, lineHeight: 18 },
  packagePriceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  packagePrice: { color: Colors.primary, fontSize: FontSize.md, fontWeight: FontWeight.bold },

  // Empty / loading states
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    gap: Spacing.md,
  },
  emptyIconRing: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  emptyBody: {
    color: Colors.textSecondary, fontSize: FontSize.sm,
    textAlign: 'center', lineHeight: 22, paddingHorizontal: Spacing.xl,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    marginTop: Spacing.sm,
  },
  emptyBtnText: { color: Colors.black, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  loadingBox: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.md },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.sm },
  noResultText: { color: Colors.textSecondary, textAlign: 'center', paddingVertical: Spacing.xl, fontSize: FontSize.sm },

  // Country picker modal
  countryModal: { flex: 1, backgroundColor: Colors.background },
  countryModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  modalCloseBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  countryModalTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  countrySearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    height: 46,
    gap: Spacing.sm,
  },
  countrySearchInput: { flex: 1, color: Colors.text, fontSize: FontSize.md, includeFontPadding: false },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: Spacing.md,
  },
  countryRowFlag: { fontSize: 20 },
  countryRowName: { flex: 1, color: Colors.text, fontSize: FontSize.md },

  // Bottom sheet backdrop
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
  },

  // Confirm bottom sheet
  confirmSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    alignSelf: 'center',
    marginBottom: Spacing.lg,
  },
  sheetPlatformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  sheetPlatformIcon: {
    width: 56, height: 56, borderRadius: Radius.md,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary,
  },
  sheetPlatformInfo: { flex: 1 },
  sheetPlatformName: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  sheetPlatformSub: { color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 3 },

  sheetDetails: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  sheetDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  sheetPriceRow: { borderBottomWidth: 0 },
  sheetDetailLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
  sheetDetailValue: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.medium, flex: 1, textAlign: 'right' },
  sheetPriceLabel: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  sheetPrice: { color: Colors.primary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },

  sheetPayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    height: 54,
    marginBottom: Spacing.sm,
  },
  sheetPayBtnText: { color: Colors.black, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  sheetCancelBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  sheetCancelText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
