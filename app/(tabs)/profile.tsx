import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import { useAuth, useAlert } from '@/template';
import { useWallet } from '@/hooks/useWallet';
import { initializeSaveCard } from '@/services/paystackService';
import { getSupabaseClient } from '@/template';
import { Colors, Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

const supabase = getSupabaseClient();

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { profile, hasCard, refreshProfile } = useWallet();
  const { showAlert } = useAlert();
  const [webViewUrl, setWebViewUrl] = useState<string | null>(null);
  const [loadingCard, setLoadingCard] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    if (user) refreshProfile();
  }, [user]);

  const handleSaveCard = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoadingCard(true);
    try {
      const data = await initializeSaveCard(user?.email || '');
      if (data?.data?.authorization_url) {
        setWebViewUrl(data.data.authorization_url);
      }
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAlert('Error', e.message);
    } finally {
      setLoadingCard(false);
    }
  };

  const handleWebViewNav = async (url: string) => {
    if (url.includes('numvault.app/payment/callback') || url.includes('paystack.com/close')) {
      setWebViewUrl(null);
      setTimeout(() => refreshProfile(), 2000);
      showAlert('Card Saved', 'Your card has been saved for future payments.');
    }
  };

  const handleRemoveCard = async () => {
    showAlert('Remove Card', 'Are you sure you want to remove your saved card?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          await supabase.from('user_profiles').update({
            card_last4: null,
            card_auth_code: null,
            card_brand: null,
            card_exp_month: null,
            card_exp_year: null,
          }).eq('id', user?.id);
          refreshProfile();
          showAlert('Card Removed', 'Your saved card has been removed.');
        },
      },
    ]);
  };

  const handleUpdateName = async () => {
    if (!newName.trim()) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await supabase.from('user_profiles').update({ name: newName.trim() }).eq('id', user?.id);
    refreshProfile();
    setEditingName(false);
    showAlert('Name Updated', 'Your profile name has been updated.');
  };

  const handleLogout = async () => {
    showAlert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          const { error } = await logout();
          if (!error) {
            router.replace('/login');
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(profile?.name || user?.email || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          {editingName ? (
            <View style={styles.nameEdit}>
              <TextInput
                style={styles.nameInput}
                value={newName}
                onChangeText={setNewName}
                placeholder="Enter your name"
                placeholderTextColor={Colors.textMuted}
                autoFocus
              />
              <TouchableOpacity onPress={handleUpdateName} style={styles.saveNameBtn}>
                <Text style={styles.saveNameText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingName(false)}>
                <MaterialIcons name="close" size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.nameRow}
              onPress={() => {
                setNewName(profile?.name || '');
                setEditingName(true);
              }}
            >
              <Text style={styles.profileName}>{profile?.name || 'Add your name'}</Text>
              <MaterialIcons name="edit" size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
          <Text style={styles.profileEmail}>{user?.email}</Text>
        </View>

        {/* Saved Card */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Payment Method</Text>
          {hasCard ? (
            <View style={styles.cardDisplay}>
              <View style={styles.cardChip}>
                <MaterialIcons name="credit-card" size={24} color={Colors.primary} />
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardBrand}>
                  {profile?.card_brand?.toUpperCase() || 'CARD'}
                </Text>
                <Text style={styles.cardNumber}>
                  •••• •••• •••• {profile?.card_last4}
                </Text>
                <Text style={styles.cardExpiry}>
                  Expires {profile?.card_exp_month}/{profile?.card_exp_year}
                </Text>
              </View>
              <TouchableOpacity onPress={handleRemoveCard} style={styles.removeCardBtn}>
                <MaterialIcons name="delete-outline" size={20} color={Colors.error} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addCardBtn}
              onPress={handleSaveCard}
              disabled={loadingCard}
              activeOpacity={0.8}
            >
              {loadingCard ? (
                <ActivityIndicator color={Colors.primary} size="small" />
              ) : (
                <>
                  <MaterialIcons name="add-card" size={22} color={Colors.primary} />
                  <View>
                    <Text style={styles.addCardTitle}>Add Payment Card</Text>
                    <Text style={styles.addCardSub}>Save card for one-tap checkout</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={Colors.textMuted} style={{ marginLeft: 'auto' }} />
                </>
              )}
            </TouchableOpacity>
          )}
          <View style={styles.securityBadge}>
            <MaterialIcons name="lock" size={12} color={Colors.primary} />
            <Text style={styles.securityText}>256-bit encrypted. We never store your card details.</Text>
          </View>
        </View>

        {/* Menu items */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.menuCard}>
            {[
              { icon: 'email', label: 'Email', value: user?.email },
              { icon: 'info-outline', label: 'App Version', value: '1.0.0' },
            ].map((item) => (
              <View key={item.label} style={styles.menuRow}>
                <MaterialIcons name={item.icon as any} size={18} color={Colors.textMuted} />
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Text style={styles.menuValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <MaterialIcons name="logout" size={18} color={Colors.error} />
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Paystack WebView for card save */}
      <Modal visible={!!webViewUrl} animationType="slide" onRequestClose={() => setWebViewUrl(null)}>
        <View style={[styles.webViewContainer, { paddingTop: insets.top }]}>
          <View style={styles.webViewHeader}>
            <TouchableOpacity onPress={() => setWebViewUrl(null)}>
              <MaterialIcons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.webViewTitle}>Save Card Securely</Text>
            <View style={{ width: 24 }} />
          </View>
          {webViewUrl && (
            <WebView
              source={{ uri: webViewUrl }}
              onNavigationStateChange={(state) => handleWebViewNav(state.url)}
              startInLoadingState
              renderLoading={() => <ActivityIndicator color={Colors.primary} style={{ flex: 1 }} />}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  headerTitle: { color: Colors.text, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  avatarSection: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primaryMuted,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Colors.primary, fontSize: FontSize.xxxl, fontWeight: FontWeight.bold },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  profileName: { color: Colors.text, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  profileEmail: { color: Colors.textSecondary, fontSize: FontSize.sm },
  nameEdit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  nameInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    height: 40,
    color: Colors.text,
    fontSize: FontSize.md,
    minWidth: 160,
  },
  saveNameBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveNameText: { color: Colors.black, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  section: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.lg },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  cardDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  cardChip: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: { flex: 1 },
  cardBrand: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  cardNumber: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  cardExpiry: { color: Colors.textSecondary, fontSize: FontSize.xs },
  removeCardBtn: { padding: 8 },
  addCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderStyle: 'dashed',
  },
  addCardTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  addCardSub: { color: Colors.textSecondary, fontSize: FontSize.xs },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.sm,
    paddingHorizontal: 4,
  },
  securityText: { color: Colors.textSecondary, fontSize: FontSize.xs, lineHeight: 18 },
  menuCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  menuLabel: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm },
  menuValue: { color: Colors.text, fontSize: FontSize.sm },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.errorMuted,
    borderWidth: 1,
    borderColor: Colors.error,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    justifyContent: 'center',
  },
  logoutText: { color: Colors.error, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  webViewContainer: { flex: 1, backgroundColor: Colors.background },
  webViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  webViewTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
});
