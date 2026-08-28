import { Redirect } from 'expo-router';

// Always show onboarding on every app open.
// Onboarding itself checks auth state and routes to /(tabs) or /login.
export default function RootScreen() {
  return <Redirect href="/onboarding" />;
}
