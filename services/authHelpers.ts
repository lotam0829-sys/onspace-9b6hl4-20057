import { getSupabaseClient } from '@/template';

/**
 * Waits up to ~2.4 s for the Supabase session to become active after verifyOtp.
 * verifyOtp resolves before the onAuthStateChange SIGNED_IN event fires, so
 * calling updateUser immediately can fail with "Auth session missing".
 */
export async function waitForSession(maxAttempts = 8, intervalMs = 300): Promise<boolean> {
  const supabase = getSupabaseClient();
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) return true;
    await new Promise<void>(r => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Calls supabase.auth.updateUser({ password }) with one automatic retry.
 * Returns null on success, or an error message string on failure.
 */
export async function setPasswordWithRetry(password: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) return null;
    console.warn(`[NumVault] updateUser attempt ${attempt} failed: ${error.message}`);
    if (attempt < 2) await new Promise<void>(r => setTimeout(r, 600));
  }
  return 'Your account was created but your password could not be saved. Please use Forgot Password to set a new password before signing in.';
}
