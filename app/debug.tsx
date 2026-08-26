import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator, TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  getProviders,
  getCountries,
  getPackages,
  Provider,
  Country,
  Package,
} from '@/services/sociallyService';
import { Colors, Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

type TestKey = 'providers' | 'countries' | 'packages';

interface TestResult {
  key: TestKey;
  label: string;
  status: 'idle' | 'loading' | 'ok' | 'error';
  duration?: number;
  data?: unknown;
  error?: string;
}

const DEFAULT_RESULTS: TestResult[] = [
  { key: 'providers', label: 'GET /sms/verification/providers', status: 'idle' },
  { key: 'countries', label: 'GET /sms/verification/provider/{code}/countries', status: 'idle' },
  { key: 'packages', label: 'POST /sms/verification/service/provider/packages', status: 'idle' },
];

export default function DebugScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [results, setResults] = useState<TestResult[]>(DEFAULT_RESULTS);
  const [providerCode, setProviderCode] = useState('server-b');
  const [countryCode, setCountryCode] = useState('tiktok');
  const [expanded, setExpanded] = useState<Record<TestKey, boolean>>({
    providers: false,
    countries: false,
    packages: false,
  });

  const setResult = (key: TestKey, patch: Partial<TestResult>) => {
    setResults((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const runTest = async (key: TestKey) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setResult(key, { status: 'loading', data: undefined, error: undefined });
    const start = Date.now();
    try {
      let data: unknown;
      if (key === 'providers') {
        data = await getProviders();
      } else if (key === 'countries') {
        data = await getCountries(providerCode);
      } else {
        data = await getPackages(providerCode, countryCode);
      }
      const duration = Date.now() - start;
      setResult(key, { status: 'ok', data, duration });
    } catch (e: any) {
      const duration = Date.now() - start;
      setResult(key, { status: 'error', error: e?.message || String(e), duration });
    }
  };

  const runAll = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    for (const r of results) {
      await runTest(r.key);
    }
  };

  const toggleExpand = (key: TestKey) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const statusIcon = (status: TestResult['status']) => {
    if (status === 'idle') return <MaterialIcons name="radio-button-unchecked" size={18} color={Colors.textMuted} />;
    if (status === 'loading') return <ActivityIndicator size="small" color={Colors.primary} />;
    if (status === 'ok') return <MaterialIcons name="check-circle" size={18} color={Colors.success} />;
    return <MaterialIcons name="cancel" size={18} color={Colors.error} />;
  };

  const statusColor = (status: TestResult['status']) => {
    if (status === 'ok') return Colors.success;
    if (status === 'error') return Colors.error;
    if (status === 'loading') return Colors.primary;
    return Colors.textMuted;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>API Debug Panel</Text>
          <Text style={styles.headerSub}>Socially.ng · Server-side proxy</Text>
        </View>
        <View style={[styles.devBadge]}>
          <Text style={styles.devBadgeText}>DEV</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Config */}
        <View style={styles.configCard}>
          <Text style={styles.configTitle}>Test Parameters</Text>
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>provider_code</Text>
            <TextInput
              style={styles.configInput}
              value={providerCode}
              onChangeText={setProviderCode}
              placeholder="server-b"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>country_code</Text>
            <TextInput
              style={styles.configInput}
              value={countryCode}
              onChangeText={setCountryCode}
              placeholder="tiktok"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.presetRow}>
            {[
              { label: 'Server B', provCode: 'server-b', countCode: 'tiktok' },
              { label: 'Server A', provCode: 'server-a', countCode: '13' },
            ].map((p) => (
              <TouchableOpacity
                key={p.label}
                style={[
                  styles.presetBtn,
                  providerCode === p.provCode && styles.presetBtnActive,
                ]}
                onPress={() => {
                  setProviderCode(p.provCode);
                  setCountryCode(p.countCode);
                }}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.presetBtnText,
                  providerCode === p.provCode && styles.presetBtnTextActive,
                ]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Run all button */}
        <TouchableOpacity style={styles.runAllBtn} onPress={runAll} activeOpacity={0.85}>
          <MaterialIcons name="play-arrow" size={20} color={Colors.black} />
          <Text style={styles.runAllText}>Run All Tests</Text>
        </TouchableOpacity>

        {/* Test results */}
        {results.map((result) => (
          <View key={result.key} style={styles.testCard}>
            {/* Test header row */}
            <View style={styles.testHeader}>
              {statusIcon(result.status)}
              <View style={{ flex: 1 }}>
                <Text style={styles.testKey}>{result.key.toUpperCase()}</Text>
                <Text style={styles.testLabel} numberOfLines={1}>{result.label}</Text>
              </View>
              {result.duration !== undefined && (
                <Text style={[styles.testDuration, { color: statusColor(result.status) }]}>
                  {result.duration}ms
                </Text>
              )}
              <TouchableOpacity
                style={[styles.runBtn, result.status === 'loading' && styles.runBtnDisabled]}
                onPress={() => runTest(result.key)}
                disabled={result.status === 'loading'}
                activeOpacity={0.8}
              >
                <MaterialIcons name="refresh" size={14} color={Colors.black} />
                <Text style={styles.runBtnText}>Run</Text>
              </TouchableOpacity>
            </View>

            {/* Summary row */}
            {result.status === 'ok' && result.data !== undefined && (
              <View style={styles.summaryRow}>
                <MaterialIcons name="check-circle" size={13} color={Colors.success} />
                <Text style={styles.summaryText}>
                  {Array.isArray(result.data)
                    ? `${(result.data as unknown[]).length} items returned`
                    : `Object with keys: ${Object.keys(result.data as object).join(', ')}`}
                </Text>
                <TouchableOpacity
                  onPress={() => toggleExpand(result.key)}
                  style={styles.expandBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.expandBtnText}>
                    {expanded[result.key] ? 'Hide JSON' : 'Show JSON'}
                  </Text>
                  <MaterialIcons
                    name={expanded[result.key] ? 'expand-less' : 'expand-more'}
                    size={14}
                    color={Colors.primary}
                  />
                </TouchableOpacity>
              </View>
            )}

            {result.status === 'error' && (
              <View style={styles.errorRow}>
                <MaterialIcons name="error-outline" size={13} color={Colors.error} />
                <Text style={styles.errorText} selectable>{result.error}</Text>
              </View>
            )}

            {/* JSON output */}
            {result.status === 'ok' && expanded[result.key] && result.data !== undefined && (
              <ScrollView
                horizontal
                style={styles.jsonScroll}
                showsHorizontalScrollIndicator={false}
              >
                <Text style={styles.jsonText} selectable>
                  {JSON.stringify(result.data, null, 2)}
                </Text>
              </ScrollView>
            )}

            {/* Field inspector for arrays */}
            {result.status === 'ok' && Array.isArray(result.data) && (result.data as unknown[]).length > 0 && (
              <View style={styles.fieldInspector}>
                <Text style={styles.fieldInspectorTitle}>
                  First item keys ({Object.keys((result.data as Record<string, unknown>[])[0]).length})
                </Text>
                <View style={styles.fieldPills}>
                  {Object.keys((result.data as Record<string, unknown>[])[0]).map((key) => (
                    <View key={key} style={styles.fieldPill}>
                      <Text style={styles.fieldPillKey}>{key}</Text>
                      <Text style={styles.fieldPillValue} numberOfLines={1}>
                        {String((result.data as Record<string, unknown>[])[0][key])}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        ))}

        {/* Quick field check */}
        <View style={styles.checklistCard}>
          <Text style={styles.checklistTitle}>Expected Field Names (Server B)</Text>
          {[
            { check: 'providers', field: 'provider_code', desc: 'e.g. "server-b"' },
            { check: 'providers', field: 'provider_name', desc: 'e.g. "Server B"' },
            { check: 'countries', field: 'country_code', desc: 'Service string e.g. "tiktok"' },
            { check: 'countries', field: 'title', desc: 'e.g. "TikTok - USA"' },
            { check: 'packages', field: 'project_code', desc: 'e.g. "tiktok"' },
            { check: 'packages', field: 'project_name', desc: 'e.g. "TikTok"' },
            { check: 'packages', field: 'price', desc: 'Numeric price in NGN' },
          ].map((item) => {
            const result = results.find((r) => r.key === item.check);
            const firstItem = Array.isArray(result?.data) && (result!.data as unknown[]).length > 0
              ? (result!.data as Record<string, unknown>[])[0]
              : null;
            const found = firstItem ? item.field in firstItem : null;
            return (
              <View key={`${item.check}-${item.field}`} style={styles.checkRow}>
                {found === null
                  ? <MaterialIcons name="radio-button-unchecked" size={14} color={Colors.textMuted} />
                  : found
                  ? <MaterialIcons name="check" size={14} color={Colors.success} />
                  : <MaterialIcons name="close" size={14} color={Colors.error} />
                }
                <View style={{ flex: 1 }}>
                  <Text style={styles.checkField}>{item.field}</Text>
                  <Text style={styles.checkDesc}>{item.desc}</Text>
                </View>
                <Text style={styles.checkEndpoint}>{item.check}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  headerSub: { color: Colors.textMuted, fontSize: 11, marginTop: 1 },
  devBadge: {
    marginLeft: 'auto' as any,
    backgroundColor: '#F59E0B22',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  devBadgeText: { color: '#F59E0B', fontSize: 10, fontWeight: FontWeight.bold },

  content: { padding: Spacing.lg, gap: Spacing.md },

  // Config
  configCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  configTitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  configRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  configLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontFamily: 'monospace' as any,
    width: 110,
  },
  configInput: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontFamily: 'monospace' as any,
    includeFontPadding: false,
  },
  presetRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  presetBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.sm,
    paddingVertical: 8,
    alignItems: 'center',
  },
  presetBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryMuted },
  presetBtnText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  presetBtnTextActive: { color: Colors.primary },

  runAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    height: 48,
  },
  runAllText: { color: Colors.black, fontSize: FontSize.md, fontWeight: FontWeight.bold },

  // Test card
  testCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  testHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  testKey: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: FontWeight.bold,
    fontFamily: 'monospace' as any,
  },
  testLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'monospace' as any,
  },
  testDuration: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
  },
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  runBtnDisabled: { opacity: 0.5 },
  runBtnText: { color: Colors.black, fontSize: 11, fontWeight: FontWeight.bold },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: Spacing.sm,
  },
  summaryText: { flex: 1, color: Colors.textSecondary, fontSize: 12 },
  expandBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  expandBtnText: { color: Colors.primary, fontSize: 11, fontWeight: FontWeight.medium },

  errorRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: Spacing.sm,
  },
  errorText: { flex: 1, color: Colors.error, fontSize: 12, lineHeight: 18 },

  jsonScroll: {
    backgroundColor: '#0A0F14',
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    maxHeight: 300,
  },
  jsonText: {
    color: '#7EE787',
    fontSize: 11,
    fontFamily: 'monospace' as any,
    padding: Spacing.md,
    lineHeight: 18,
  },

  // Field inspector
  fieldInspector: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    padding: Spacing.md,
  },
  fieldInspectorTitle: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: Spacing.sm,
  },
  fieldPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fieldPill: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    maxWidth: 160,
  },
  fieldPillKey: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: FontWeight.bold,
    fontFamily: 'monospace' as any,
  },
  fieldPillValue: {
    color: Colors.textMuted,
    fontSize: 9,
    fontFamily: 'monospace' as any,
  },

  // Field checklist
  checklistCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  checklistTitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.md,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  checkField: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: FontWeight.semibold,
    fontFamily: 'monospace' as any,
  },
  checkDesc: { color: Colors.textMuted, fontSize: 10, marginTop: 2 },
  checkEndpoint: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: FontWeight.bold,
    textTransform: 'uppercase',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
});
