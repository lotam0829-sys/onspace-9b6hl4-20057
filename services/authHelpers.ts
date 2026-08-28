import { getSupabaseClient } from '@/template';

/**
 * Waits up to ~10 s for the Supabase session to become active after verifyOtp.
 * verifyOtp resolves before the onAuthStateChange SIGNED_IN event fires, so
 * calling updateUser immediately can fail with "Auth session missing".
 * 20 attempts × 500 ms = 10 s ceiling — enough for slow network conditions.
 */
export async function waitForSession(maxAttempts = 20, intervalMs = 500): Promise<boolean> {
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
    // 422 "New password should be different from the old password" means the
    // password is already set to this value (e.g. on a retry) — treat as success.
    if (error.status === 422 || error.message?.toLowerCase().includes('same password') || error.message?.toLowerCase().includes('different from')) {
      return null;
    }
    console.warn(`[NumVault] updateUser attempt ${attempt} failed: ${error.message}`);
    if (attempt < 2) await new Promise<void>(r => setTimeout(r, 1500));
  }
  return 'Your account was created but your password could not be saved. Please use Forgot Password to set a new password before signing in.';
}
