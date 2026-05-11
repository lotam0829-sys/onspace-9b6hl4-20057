import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, TextInput, ActivityIndicator, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/template';
import { getProviders, getCountries, getPackages, Provider, Country, Package } from '@/services/sociallyService';
import { PLATFORM_DESCRIPTIONS, PLATFORM_ICONS } from '@/constants/config';
import { Colors, Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

const DEFAULT_PROVIDER = 'server-b';

type Step = 'platform' | 'country';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [step, setStep] = useState<Step>('platform');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const [search, setSearch] = useState('');
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [descModal, setDescModal] = useState<{ name: string; desc: string } | null>(null);

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    setLoadingProviders(true);
    try {
      const data = await getProviders();
      setProviders(data);
      // Always prefer server-b; fall back to first provider
      const serverB = data.find((p) => p.provider_code === DEFAULT_PROVIDER) || data[0];
      if (serverB) {
        setSelectedProvider(serverB);
        loadCountries(serverB.provider_code);
      }
    } catch (e) {
      console.error('Failed to load providers:', e);
    } finally {
      setLoadingProviders(false);
    }
  };

  const loadCountries = async (providerCode: string) => {
    setLoadingCountries(true);
    setCountries([]);
    try {
      const data = await getCountries(providerCode);
      setCountries(data);
    } catch (e) {
      console.error('Failed to load countries:', e);
    } finally {
      setLoadingCountries(false);
    }
  };

  const loadPackages = async (countryCode: number) => {
    if (!selectedProvider) return;
    setLoadingPackages(true);
    setPackages([]);
    try {
      const data = await getPackages(selectedProvider.provider_code, countryCode);
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
    setSearch('');
    setStep('platform');
    loadPackages(country.country_code);
  };

  const handlePackageSelect = async (pkg: Package) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const desc =
      PLATFORM_DESCRIPTIONS[pkg.project_name] ||
      `Get a real temporary number from your chosen country to complete verification on ${pkg.project_name}. The OTP will be delivered to you automatically.`;
    setSelectedPackage(pkg);
    setDescModal({ name: pkg.project_name, desc });
  };

  const proceedToCheckout = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDescModal(null);
    if (!selectedPackage || !selectedCountry || !selectedProvider) return;
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
  };

  const filteredCountries = countries.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  const filteredPackages = packages.filter((p) =>
    p.project_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>NumVault</Text>
          <Text style={styles.headerSub}>SMS Verification Numbers</Text>
        </View>
        <View style={styles.providerBadge}>
          <MaterialIcons name="dns" size={13} color={Colors.primary} />
          <Text style={styles.providerText}>{selectedProvider?.provider_name || 'SERVER B'}</Text>
        </View>
      </View>

      {/* Trust badges */}
      <View style={styles.trustRow}>
        {[
          { icon: 'bolt', label: 'Instant Delivery' },
          { icon: 'lock', label: 'Secure Payment' },
          { icon: 'public', label: '200+ Countries' },
        ].map((b) => (
          <View key={b.label} style={styles.trustBadge}>
            <MaterialIcons name={b.icon as any} size={12} color={Colors.primary} />
            <Text style={styles.trustText}>{b.label}</Text>
          </View>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {/* Step indicator */}
        <View style={styles.stepIndicator}>
          <StepDot num={1} label="Platform" active={step === 'platform'} done={!!selectedPackage && step !== 'platform'} />
          <View style={styles.stepLine} />
          <StepDot num={2} label="Country" active={step === 'country'} done={!!selectedCountry} />
        </View>

        {/* Section header */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {step === 'country' ? 'Choose Country' : 'Choose Platform'}
            </Text>
            <TouchableOpacity
              onPress={async () => {
                await Haptics.selectionAsync();
                setStep(step === 'country' ? 'platform' : 'country');
                setSearch('');
              }}
              style={styles.switchBtn}
            >
              <Text style={styles.switchBtnText}>
                {step === 'country' ? 'Pick Platform' : 'Change Country'}
              </Text>
            </TouchableOpacity>
          </View>

          {selectedCountry && step === 'platform' && (
            <TouchableOpacity
              style={styles.selectedCountry}
              onPress={() => { setStep('country'); setSearch(''); }}
              activeOpacity={0.8}
            >
              <Text style={styles.flagEmoji}>🌍</Text>
              <Text style={styles.selectedCountryText}>{selectedCountry.title}</Text>
              <MaterialIcons name="edit" size={14} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <MaterialIcons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={step === 'country' ? 'Search countries...' : 'Search platforms...'}
            placeholderTextColor={Colors.textMuted}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <MaterialIcons name="close" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Country list */}
        {step === 'country' && (
          <View style={styles.listContainer}>
            {loadingCountries ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
            ) : filteredCountries.length === 0 ? (
              <Text style={styles.emptyText}>No countries found</Text>
            ) : (
              filteredCountries.map((country) => (
                <TouchableOpacity
                  key={country.country_code}
                  style={[
                    styles.listItem,
                    selectedCountry?.country_code === country.country_code && styles.listItemSelected,
                  ]}
                  onPress={() => handleCountrySelect(country)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.countryFlag}>🌍</Text>
                  <Text style={styles.listItemText}>{country.title}</Text>
                  {selectedCountry?.country_code === country.country_code && (
                    <MaterialIcons name="check-circle" size={18} color={Colors.primary} />
                  )}
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* Platform / Package list */}
        {step === 'platform' && (
          <View style={styles.listContainer}>
            {loadingPackages ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={Colors.primary} />
                <Text style={styles.loadingText}>
                  {selectedCountry ? 'Loading available platforms...' : 'Select a country to see platforms'}
                </Text>
              </View>
            ) : !selectedCountry ? (
              <View style={styles.noCountry}>
                <MaterialIcons name="public" size={48} color={Colors.textMuted} />
                <Text style={styles.noCountryTitle}>Choose a Country First</Text>
                <Text style={styles.noCountryText}>
                  Tap "Change Country" to select which country you need a number from
                </Text>
                <TouchableOpacity
                  style={styles.noCountryBtn}
                  onPress={() => setStep('country')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.noCountryBtnText}>Choose Country</Text>
                </TouchableOpacity>
              </View>
            ) : filteredPackages.length === 0 ? (
              <Text style={styles.emptyText}>No platforms found</Text>
            ) : (
              <View style={styles.packageGrid}>
                {filteredPackages.map((pkg) => (
                  <TouchableOpacity
                    key={pkg.project_code}
                    style={styles.packageCard}
                    onPress={() => handlePackageSelect(pkg)}
                    activeOpacity={0.75}
                  >
                    <MaterialIcons
                      name={(PLATFORM_ICONS[pkg.project_name] || 'phone-android') as any}
                      size={24}
                      color={Colors.primary}
                    />
                    <Text style={styles.packageName} numberOfLines={2}>{pkg.project_name}</Text>
                    <Text style={styles.packagePrice}>₦{pkg.displayPrice.toLocaleString()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Platform Description Modal */}
      <Modal
        visible={!!descModal}
        transparent
        animationType="slide"
        onRequestClose={() => setDescModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <MaterialIcons
              name={(PLATFORM_ICONS[descModal?.name || ''] || 'phone-android') as any}
              size={40}
              color={Colors.primary}
              style={{ marginBottom: Spacing.md }}
            />
            <Text style={styles.modalTitle}>{descModal?.name}</Text>
            <Text style={styles.modalDesc}>{descModal?.desc}</Text>

            <View style={styles.modalMeta}>
              <View style={styles.modalMetaItem}>
                <Text style={styles.modalMetaLabel}>Country</Text>
                <Text style={styles.modalMetaValue}>{selectedCountry?.title}</Text>
              </View>
              <View style={styles.modalMetaDivider} />
              <View style={styles.modalMetaItem}>
                <Text style={styles.modalMetaLabel}>Price</Text>
                <Text style={[styles.modalMetaValue, { color: Colors.primary }]}>
                  ₦{selectedPackage?.displayPrice.toLocaleString()}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={styles.modalCta} onPress={proceedToCheckout} activeOpacity={0.85}>
              <MaterialIcons name="shopping-cart" size={18} color={Colors.black} />
              <Text style={styles.modalCtaText}>Get My Number</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setDescModal(null)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StepDot({ num, label, active, done }: { num: number; label: string; active: boolean; done: boolean }) {
  return (
    <View style={stepStyles.container}>
      <View style={[stepStyles.dot, active && stepStyles.dotActive, done && stepStyles.dotDone]}>
        {done ? (
          <MaterialIcons name="check" size={12} color={Colors.black} />
        ) : (
          <Text style={stepStyles.num}>{num}</Text>
        )}
      </View>
      <Text style={[stepStyles.label, active && stepStyles.labelActive]}>{label}</Text>
    </View>
  );
}

const stepStyles = StyleSheet.create({
  container: { alignItems: 'center', gap: 4 },
  dot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  dotActive: { backgroundColor: Colors.primaryMuted, borderColor: Colors.primary },
  dotDone: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  num: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  label: { color: Colors.textMuted, fontSize: FontSize.xs },
  labelActive: { color: Colors.primary },
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
  appName: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold, letterSpacing: 0.5 },
  headerSub: { color: Colors.textSecondary, fontSize: FontSize.xs },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primaryMuted,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  providerText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  trustText: { color: Colors.textSecondary, fontSize: 10 },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
  },
  stepLine: { flex: 1, height: 1, backgroundColor: Colors.surfaceBorder, marginHorizontal: Spacing.md },
  section: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sectionTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  switchBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  switchBtnText: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  selectedCountry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  flagEmoji: { fontSize: 20 },
  selectedCountryText: { flex: 1, color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    marginHorizontal: Spacing.lg,
    paddingHorizontal: Spacing.md,
    height: 44,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  searchInput: { flex: 1, color: Colors.text, fontSize: FontSize.md, includeFontPadding: false },
  listContainer: { paddingHorizontal: Spacing.lg },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  listItemSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryMuted },
  countryFlag: { fontSize: 18 },
  listItemText: { flex: 1, color: Colors.text, fontSize: FontSize.md },
  loadingBox: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.md },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center' },
  noCountry: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.md },
  noCountryTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  noCountryText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 22,
  },
  noCountryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  noCountryBtnText: { color: Colors.black, fontWeight: FontWeight.bold, fontSize: FontSize.md },
  emptyText: { color: Colors.textSecondary, textAlign: 'center', paddingVertical: Spacing.xl, fontSize: FontSize.sm },
  packageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  packageCard: {
    width: '47%',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  packageName: { color: Colors.text, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, lineHeight: 18 },
  packagePrice: { color: Colors.primary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.xl,
    paddingBottom: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceBorder, marginBottom: Spacing.lg },
  modalTitle: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold, marginBottom: Spacing.sm },
  modalDesc: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  modalMeta: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    padding: Spacing.md,
    width: '100%',
    marginBottom: Spacing.lg,
  },
  modalMetaItem: { flex: 1, alignItems: 'center', gap: 4 },
  modalMetaDivider: { width: 1, backgroundColor: Colors.surfaceBorder },
  modalMetaLabel: { color: Colors.textSecondary, fontSize: FontSize.xs },
  modalMetaValue: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  modalCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    height: 52,
    justifyContent: 'center',
    width: '100%',
    marginBottom: Spacing.sm,
  },
  modalCtaText: { color: Colors.black, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  modalCancel: { paddingVertical: Spacing.md },
  modalCancelText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
