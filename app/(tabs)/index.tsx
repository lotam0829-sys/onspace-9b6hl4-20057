import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, TextInput, ActivityIndicator, Animated,
  RefreshControl, FlatList, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/template';
import {
  getServiceList, getServicePrice, getCountries, getPackagesForCountry,
  ServiceItem, ServiceCategory, Country, Package,
} from '@/services/sociallyService';
import { PLATFORM_ICONS } from '@/constants/config';
import { Colors, Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

// ── Providers ────────────────────────────────────────────────────────────────

type ProviderCode = 'server-b' | 'server-a';

const PROVIDERS: { code: ProviderCode; label: string; desc: string }[] = [
  { code: 'server-b', label: 'Server B', desc: 'US-based services' },
  { code: 'server-a', label: 'Server A', desc: 'Multi-country numbers' },
];

const CATEGORIES: ServiceCategory[] = ['All', 'Social', 'Messaging', 'Finance', 'Shopping', 'Other'];

const CATEGORY_ICONS: Record<ServiceCategory, string> = {
  All: 'apps',
  Social: 'people',
  Messaging: 'chat-bubble',
  Finance: 'account-balance-wallet',
  Shopping: 'shopping-cart',
  Other: 'more-horiz',
};

// ── Main screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [provider, setProvider] = useState<ProviderCode>('server-b');

  // Server B state
  const [allServices, setAllServices] = useState<ServiceItem[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<ServiceCategory>('All');
  // Lazy price cache: country_code → Package | null
  const priceCache = useRef<Map<string, Package | null>>(new Map());
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [sheetPriceReady, setSheetPriceReady] = useState(false);

  // Server A state (two-step: country → platform)
  const [serverACountries, setServerACountries] = useState<Country[]>([]);
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [countryPackages, setCountryPackages] = useState<Package[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [packageError, setPackageError] = useState<string | null>(null);

  // Bottom sheet (shared for Server B service preview + Server A package preview)
  const [sheetService, setSheetService] = useState<ServiceItem | null>(null);
  const [sheetPackage, setSheetPackage] = useState<{
    country: Country;
    pkg: Package;
  } | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  // ── Load on provider change ──
  useEffect(() => {
    setSearchQuery('');
    setCountrySearch('');
    setActiveCategory('All');
    setSelectedCountry(null);
    setCountryPackages([]);
    setSheetService(null);
    setSheetPackage(null);

    if (provider === 'server-b') {
      loadServerBServices();
    } else {
      loadServerACountries();
    }
  }, [provider]);

  // ══ Server B ══════════════════════════════════════════════════════════════

  const loadServerBServices = async (isRefresh = false) => {
    if (isRefresh) { setRefreshing(true); priceCache.current.clear(); }
    else setLoadingServices(true);

    try {
      const items = await getServiceList('server-b');
      setAllServices(items);
    } catch (e) {
      console.error('Failed to load Server B services:', e);
    } finally {
      setLoadingServices(false);
      setRefreshing(false);
    }
  };

  const filteredServices = allServices.filter((s) => {
    const matchesSearch = s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.country_code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === 'All' || s.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const categoryCounts = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = cat === 'All'
      ? allServices.length
      : allServices.filter((s) => s.category === cat).length;
    return acc;
  }, {} as Record<ServiceCategory, number>);

  // ══ Server A ══════════════════════════════════════════════════════════════

  const loadServerACountries = async () => {
    setLoadingCountries(true);
    try {
      const list = await getCountries('server-a');
      setServerACountries(list);
    } catch (e) {
      console.error('Failed to load Server A countries:', e);
    } finally {
      setLoadingCountries(false);
    }
  };

  const selectCountry = async (country: Country) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCountry(country);
    setCountryPackages([]);
    setPackageError(null);
    setLoadingPackages(true);
    try {
      const pkgs = await getPackagesForCountry('server-a', country.country_code);
      setCountryPackages(pkgs);
      if (pkgs.length === 0) {
        setPackageError(`No platforms available for ${country.title}`);
      }
    } catch (e: any) {
      console.error('Failed to load packages:', e);
      setPackageError(e?.message || 'Failed to load platforms');
    } finally {
      setLoadingPackages(false);
    }
  };

  const filteredCountries = serverACountries.filter((c) =>
    c.title.toLowerCase().includes(countrySearch.toLowerCase())
  );

  // ══ Bottom Sheet ══════════════════════════════════════════════════════════

  const openSheetService = async (svc: ServiceItem) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSheetService(svc);
    setSheetPackage(null);
    setSheetPriceReady(false);
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();

    // Lazy-load price if not cached
    const cached = priceCache.current.get(svc.country_code);
    if (cached !== undefined) {
      // Already fetched (even if null)
      setSheetService((prev) => prev ? { ...prev, package: cached ?? prev.package } : prev);
      setSheetPriceReady(true);
      return;
    }
    setFetchingPrice(true);
    try {
      const pkg = await getServicePrice('server-b', svc.country_code);
      priceCache.current.set(svc.country_code, pkg);
      setSheetService((prev) => prev && prev.country_code === svc.country_code
        ? { ...prev, package: pkg ?? prev.package }
        : prev
      );
      setSheetPriceReady(true);
    } catch {
      priceCache.current.set(svc.country_code, null);
      setSheetPriceReady(true);
    } finally {
      setFetchingPrice(false);
    }
  };

  const openSheetPackage = async (country: Country, pkg: Package) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSheetPackage({ country, pkg });
    setSheetService(null);
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      setSheetService(null);
      setSheetPackage(null);
    });
  };

  const proceedToCheckout = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    let params: Record<string, string> = {};

    if (sheetService) {
      params = {
        provider_code: 'server-b',
        country_code: sheetService.country_code,
        country_name: sheetService.title,
        project_code: sheetService.package.project_code,
        project_name: sheetService.package.project_name,
        price: String(sheetService.package.displayPrice),
      };
    } else if (sheetPackage) {
      params = {
        provider_code: 'server-a',
        country_code: sheetPackage.country.country_code,
        country_name: sheetPackage.country.title,
        project_code: sheetPackage.pkg.project_code,
        project_name: sheetPackage.pkg.project_name,
        price: String(sheetPackage.pkg.displayPrice),
      };
    } else return;

    closeSheet();
    setTimeout(() => router.push({ pathname: '/checkout', params }), 250);
  };

  const sheetTranslateY = sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [600, 0] });
  const sheetPrice = sheetService ? (sheetService.package.displayPrice || 0) : sheetPackage ? sheetPackage.pkg.displayPrice : 0;
  const sheetHasPrice = sheetPrice > 0;

  const sheetData = sheetService
    ? { title: sheetService.title, price: sheetPrice, category: sheetService.category, provider: 'Server B' }
    : sheetPackage
    ? { title: `${sheetPackage.pkg.project_name} — ${sheetPackage.country.title}`, price: sheetPackage.pkg.displayPrice, category: null, provider: 'Server A' }
    : null;

  const firstName = user?.username?.split(' ')[0] || user?.email?.split('@')[0] || 'there';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hey, {firstName} 👋</Text>
          <Text style={styles.tagline}>Pick a service, get your number.</Text>
        </View>
      </View>

      {/* ── Provider tabs ── */}
      <View style={styles.providerRow}>
        {PROVIDERS.map((p) => {
          const active = provider === p.code;
          return (
            <TouchableOpacity
              key={p.code}
              style={[styles.providerTab, active && styles.providerTabActive]}
              onPress={async () => {
                await Haptics.selectionAsync();
                setProvider(p.code);
              }}
              activeOpacity={0.8}
            >
              <View style={[styles.providerDot, active && styles.providerDotActive]} />
              <View>
                <Text style={[styles.providerTabLabel, active && styles.providerTabLabelActive]}>
                  {p.label}
                </Text>
                <Text style={styles.providerTabDesc}>{p.desc}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ══════════ SERVER B CONTENT ══════════ */}
      {provider === 'server-b' && (
        <>
          {/* Search */}
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

          {loadingServices ? (
            <View style={styles.loadingContainer}>
              <View style={styles.loadingCard}>
                <ActivityIndicator color={Colors.primary} size="large" />
                <Text style={styles.loadingTitle}>Loading services...</Text>
                <Text style={styles.loadingSubtitle}>Fetching service list from Server B</Text>
              </View>
            </View>
          ) : (
            <>
              {/* Category chips */}
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
                      onPress={async () => { await Haptics.selectionAsync(); setActiveCategory(cat); }}
                      activeOpacity={0.8}
                    >
                      <MaterialIcons name={CATEGORY_ICONS[cat] as any} size={14} color={active ? Colors.black : Colors.textSecondary} />
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

              {filteredServices.length === 0 ? (
                <View style={styles.emptyCenter}>
                  <View style={styles.emptyIcon}>
                    <MaterialIcons name="search-off" size={32} color={Colors.textMuted} />
                  </View>
                  <Text style={styles.emptyTitle}>No results</Text>
                  <Text style={styles.emptySub}>
                    {searchQuery ? `No services match "${searchQuery}"` : `No services in ${activeCategory}`}
                  </Text>
                  <TouchableOpacity style={styles.clearBtn} onPress={() => { setSearchQuery(''); setActiveCategory('All'); }}>
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
                    <RefreshControl refreshing={refreshing} onRefresh={() => loadServerBServices(true)} tintColor={Colors.primary} colors={[Colors.primary]} />
                  }
                  ListHeaderComponent={
                    <Text style={styles.resultsCount}>
                      {filteredServices.length} service{filteredServices.length !== 1 ? 's' : ''}
                      {activeCategory !== 'All' ? ` · ${activeCategory}` : ''}
                    </Text>
                  }
                  renderItem={({ item }) => (
                    <ServiceCard service={item} onPress={() => openSheetService(item)} />
                  )}
                />
              )}
            </>
          )}
        </>
      )}

      {/* ══════════ SERVER A CONTENT ══════════ */}
      {provider === 'server-a' && (
        <View style={{ flex: 1 }}>
          {loadingCountries ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={Colors.primary} size="large" />
              <Text style={[styles.loadingTitle, { marginTop: Spacing.md }]}>Loading countries...</Text>
            </View>
          ) : (
            <>
              {/* Country search */}
              <View style={styles.searchWrap}>
                <View style={styles.searchBar}>
                  <MaterialIcons name="public" size={18} color={Colors.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    value={countrySearch}
                    onChangeText={setCountrySearch}
                    placeholder={provider === 'server-b' ? 'Search services...' : 'Search countries...'}
                    placeholderTextColor={Colors.textMuted}
                  />
                  {countrySearch.length > 0 && (
                    <TouchableOpacity onPress={() => setCountrySearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <MaterialIcons name="close" size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Country list + packages panel */}
              <View style={styles.serverALayout}>
                {/* Country list */}
                <FlatList
                  style={styles.countryList}
                  data={filteredCountries}
                  keyExtractor={(item) => item.country_code}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: insets.bottom + 32, paddingTop: Spacing.xs }}
                  ListHeaderComponent={
                    <Text style={styles.resultsCount}>
                        {filteredCountries.length} {provider === 'server-b' ? 'services' : 'countries'}
                      </Text>
                  }
                  renderItem={({ item }) => {
                    const active = selectedCountry?.country_code === item.country_code;
                    return (
                      <TouchableOpacity
                        style={[styles.countryItem, active && styles.countryItemActive]}
                        onPress={() => selectCountry(item)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.countryFlag}>{getFlagEmoji(item.code)}</Text>
                        <Text style={[styles.countryName, active && styles.countryNameActive]} numberOfLines={1}>
                          {item.title}
                        </Text>
                        {active && <MaterialIcons name="chevron-right" size={16} color={Colors.primary} />}
                      </TouchableOpacity>
                    );
                  }}
                />

                {/* Platform packages for selected country */}
                <View style={styles.packagesPanel}>
                  {!selectedCountry ? (
                    <View style={styles.selectCountryHint}>
                      <MaterialIcons name="arrow-back" size={24} color={Colors.textMuted} />
                      <Text style={styles.selectCountryText}>Select a country to see available platforms</Text>
                    </View>
                  ) : loadingPackages ? (
                    <View style={styles.packageLoading}>
                      <ActivityIndicator color={Colors.primary} />
                      <Text style={styles.packageLoadingText}>Loading...</Text>
                    </View>
                  ) : countryPackages.length === 0 ? (
                    <View style={styles.selectCountryHint}>
                      <MaterialIcons name="info-outline" size={24} color={Colors.textMuted} />
                      <Text style={styles.selectCountryText}>
                        {packageError || `No platforms available for ${selectedCountry.title}`}
                      </Text>
                      <Text style={[styles.selectCountryText, { fontSize: 10, marginTop: 4 }]}>
                        country_code: {selectedCountry.country_code} · code: {selectedCountry.code}
                      </Text>
                    </View>
                  ) : (
                    <FlatList
                      data={countryPackages}
                      keyExtractor={(item) => item.project_code}
                      showsVerticalScrollIndicator={false}
                      contentContainerStyle={{ paddingBottom: insets.bottom + 32, paddingTop: Spacing.xs }}
                      ListHeaderComponent={
                        <Text style={styles.resultsCount}>
                          {selectedCountry.title} · {countryPackages.length} platforms
                        </Text>
                      }
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={styles.packageItem}
                          onPress={() => openSheetPackage(selectedCountry, item)}
                          activeOpacity={0.8}
                        >
                          <View style={styles.packageIconWrap}>
                            <MaterialIcons
                              name={(PLATFORM_ICONS[item.project_name] || 'phone-android') as any}
                              size={20}
                              color={Colors.primary}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.packageName} numberOfLines={1}>{item.project_name}</Text>
                            <Text style={styles.packagePrice}>₦{item.displayPrice.toLocaleString()}</Text>
                          </View>
                          <MaterialIcons name="arrow-forward-ios" size={12} color={Colors.textMuted} />
                        </TouchableOpacity>
                      )}
                    />
                  )}
                </View>
              </View>
            </>
          )}
        </View>
      )}

      {/* ══════════ BOTTOM SHEET ══════════ */}
      {!!sheetData && (
        <>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeSheet} />
          <Animated.View
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + 24, transform: [{ translateY: sheetTranslateY }] },
            ]}
          >
            <View style={styles.sheetHandle} />

            <View style={styles.sheetServiceRow}>
              <View style={styles.sheetServiceIcon}>
                <MaterialIcons
                  name={(PLATFORM_ICONS[sheetData.title.split(' —')[0]?.split(' -')[0]?.trim()] || 'phone-android') as any}
                  size={26}
                  color={Colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetServiceName} numberOfLines={2}>{sheetData.title}</Text>
                <View style={styles.sheetServerTag}>
                  <View style={styles.serverDot} />
                  <Text style={styles.sheetServerTagText}>{sheetData.provider} · SMS Verification</Text>
                </View>
              </View>
            </View>

            <View style={styles.sheetDetails}>
              {[
                { label: 'You receive', value: 'Real temporary phone number' },
                { label: 'OTP delivery', value: 'Auto-captured within 10 min' },
                { label: 'Refund policy', value: 'Auto-refund if no OTP in 5 mins', green: true },
              ].map((row) => (
                <View key={row.label} style={styles.sheetRow}>
                  <Text style={styles.sheetRowLabel}>{row.label}</Text>
                  <Text style={[styles.sheetRowValue, row.green && { color: Colors.primary }]}>{row.value}</Text>
                </View>
              ))}
              <View style={[styles.sheetRow, styles.sheetPriceRow]}>
                <Text style={styles.sheetPriceLabel}>Total</Text>
                {fetchingPrice
                  ? <ActivityIndicator color={Colors.primary} size="small" />
                  : <Text style={sheetHasPrice ? styles.sheetPrice : styles.sheetPriceLoading}>
                      {sheetHasPrice ? `₦${sheetData.price.toLocaleString()}` : 'Not available'}
                    </Text>
                }
              </View>
            </View>

            <TouchableOpacity
              style={[styles.sheetPayBtn, (!sheetHasPrice || fetchingPrice) && styles.sheetPayBtnDisabled]}
              onPress={proceedToCheckout}
              disabled={!sheetHasPrice || fetchingPrice}
              activeOpacity={0.88}
            >
              {fetchingPrice ? (
                <ActivityIndicator color={Colors.black} size="small" />
              ) : (
                <>
                  <MaterialIcons name="lock" size={16} color={Colors.black} />
                  <Text style={styles.sheetPayBtnText}>
                    {sheetHasPrice ? `Pay ₦${sheetData.price.toLocaleString()}` : 'Price unavailable'}
                  </Text>
                </>
              )}
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

// ── Helper ───────────────────────────────────────────────────────────────────

function getFlagEmoji(countryCode: string): string {
  const code = countryCode?.toUpperCase();
  if (!code || code.length !== 2 || !/^[A-Z]{2}$/.test(code)) return '🌐';
  const offset = 127397;
  return String.fromCodePoint(...code.split('').map((c) => c.charCodeAt(0) + offset));
}

// ── Service Card (Server B) ──────────────────────────────────────────────────

function ServiceCard({ service, onPress }: { service: ServiceItem; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true, speed: 30 }).start();
  const onPressOut = () => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30 }).start();

  const parts = service.title.split(' - ');
  const mainName = parts[0]?.trim() || service.title;
  const subName = parts[1]?.trim() || null;

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
            <MaterialIcons name={(PLATFORM_ICONS[mainName] || 'phone-android') as any} size={22} color={Colors.primary} />
          </View>
          <View style={styles.cardCatTag}>
            <Text style={styles.cardCatTagText}>{service.category}</Text>
          </View>
        </View>
        <Text style={styles.cardName} numberOfLines={2}>{mainName}</Text>
        {subName && <Text style={styles.cardSub} numberOfLines={1}>{subName}</Text>}
        <Text style={styles.cardPrice}>₦{service.package.displayPrice.toLocaleString()}</Text>
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
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  greeting: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  tagline: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 2 },

  // Provider tabs
  providerRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  providerTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  providerTabActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryMuted,
  },
  providerDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.textMuted,
  },
  providerDotActive: { backgroundColor: Colors.primary },
  providerTabLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  providerTabLabelActive: { color: Colors.primary },
  providerTabDesc: { color: Colors.textMuted, fontSize: 10, marginTop: 1 },

  serverDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.primary },

  // Search
  searchWrap: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 46,
  },
  searchInput: { flex: 1, color: Colors.text, fontSize: FontSize.sm, includeFontPadding: false },

  // Loading
  loadingContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg,
  },
  loadingCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing.xl, alignItems: 'center', gap: Spacing.md, width: '100%',
  },
  loadingTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  loadingSubtitle: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center' },
  // Category chips
  categoryRow: {
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.sm,
    flexDirection: 'row', alignItems: 'center',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 7,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: FontWeight.medium },
  chipTextActive: { color: Colors.black },
  chipCount: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.full,
    paddingHorizontal: 5, paddingVertical: 1, minWidth: 20, alignItems: 'center',
  },
  chipCountActive: { backgroundColor: 'rgba(0,0,0,0.2)' },
  chipCountText: { color: Colors.textMuted, fontSize: 10, fontWeight: FontWeight.bold },
  chipCountTextActive: { color: Colors.black },

  resultsCount: { color: Colors.textMuted, fontSize: 11, marginBottom: Spacing.sm, marginLeft: 2 },

  // Empty
  emptyCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.md, paddingHorizontal: Spacing.xl,
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

  // Service card (Server B)
  cardWrap: { flex: 1 },
  card: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg, padding: Spacing.md, gap: 6, minHeight: 145,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardIconWrap: {
    width: 40, height: 40, borderRadius: Radius.md,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,200,83,0.2)',
  },
  cardCatTag: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.full,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  cardCatTagText: { color: Colors.textMuted, fontSize: 9, fontWeight: FontWeight.semibold },
  cardName: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.bold, lineHeight: 18 },
  cardSub: { color: Colors.textMuted, fontSize: 10 },
  cardPrice: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 'auto' as any,
  },
  cardBuyLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: FontWeight.medium },

  // Server A layout
  serverALayout: { flex: 1, flexDirection: 'row' },
  countryList: {
    width: 140,
    borderRightWidth: 1,
    borderRightColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing.sm,
  },
  countryItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: Radius.sm, marginBottom: 2,
  },
  countryItemActive: {
    backgroundColor: Colors.primaryMuted,
    borderWidth: 1, borderColor: 'rgba(0,200,83,0.2)',
  },
  countryFlag: { fontSize: 18 },
  countryName: {
    flex: 1, color: Colors.textSecondary, fontSize: 12, fontWeight: FontWeight.medium,
  },
  countryNameActive: { color: Colors.primary },

  packagesPanel: { flex: 1, paddingHorizontal: Spacing.md },
  packageLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  packageLoadingText: { color: Colors.textSecondary, fontSize: FontSize.sm },
  selectCountryHint: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, paddingHorizontal: Spacing.md,
  },
  selectCountryText: {
    color: Colors.textMuted, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20,
  },
  packageItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm,
  },
  packageIconWrap: {
    width: 38, height: 38, borderRadius: Radius.sm,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  packageName: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  packagePrice: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.bold, marginTop: 2 },

  // Backdrop
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.overlay },

  // Sheet
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    borderTopWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing.lg, paddingTop: Spacing.md,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceBorder,
    alignSelf: 'center', marginBottom: Spacing.lg,
  },
  sheetServiceRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg,
  },
  sheetServiceIcon: {
    width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.primaryMuted,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary, flexShrink: 0,
  },
  sheetServiceName: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.bold, lineHeight: 24 },
  sheetServerTag: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  sheetServerTagText: { color: Colors.textSecondary, fontSize: FontSize.xs },

  sheetDetails: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
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
  sheetPriceLoading: { color: Colors.textMuted, fontSize: FontSize.md, fontStyle: 'italic' },

  sheetPayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.md, height: 54, marginBottom: Spacing.sm,
  },
  sheetPayBtnDisabled: { opacity: 0.5 },
  sheetPayBtnText: { color: Colors.black, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  sheetCancelBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  sheetCancelText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
