import { AuthRouter } from '@/template';
import { Redirect } from 'expo-router';

export default function RootScreen() {
  return (
    <AuthRouter loginRoute="/login" excludeRoutes={['/onboarding']}>
      <Redirect href="/(tabs)" />
    </AuthRouter>
  );
}
