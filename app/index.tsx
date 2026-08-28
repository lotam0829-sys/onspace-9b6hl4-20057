import { AuthRouter } from '@/template';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/theme';

export default function RootScreen() {
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    // Always show onboarding on every fresh app open — do not persist the flag
    setOnboardingDone(false);
    setOnboardingChecked(true);
  }, []);

  if (!onboardingChecked) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!onboardingDone) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <AuthRouter loginRoute="/login" excludeRoutes={['/onboarding']}>
      <Redirect href="/(tabs)" />
    </AuthRouter>
  );
}
