import * as Linking from 'expo-linking';
import { useCallback, type Dispatch, type SetStateAction } from 'react';

import { supabase } from '@/lib/supabase';
import { TENANT } from '@/tenant';
import { recoveryRedirectUrl } from '@platform/domain';

type AuthActionSetters = {
  setError: Dispatch<SetStateAction<string | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsPasswordRecovery: Dispatch<SetStateAction<boolean>>;
};

export function useAuthActions({ setError, setIsLoading, setIsPasswordRecovery }: AuthActionSetters) {
  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    setError(null);
    setIsLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setIsLoading(false);
      throw new Error(signInError.message);
    }
  }, [setError, setIsLoading]);

  // Every OTP path carries brand_slug: the claims hook bootstraps a brand-new
  // user's tenancy claim from it, validated against brands.slug server-side.
  const signInWithEmailOtp = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Live sign-in is not configured in this build.');
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, data: { brand_slug: TENANT.identity.slug } },
    });
    if (otpError) throw new Error(otpError.message);
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    if (!supabase) throw new Error('Live sign-in is not configured in this build.');
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    });
    if (verifyError) throw new Error(verifyError.message);
  }, []);

  const signInWithPhone = useCallback(async (phone: string) => {
    if (!supabase) throw new Error('Live sign-in is not configured in this build.');
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone,
      options: { data: { brand_slug: TENANT.identity.slug } },
    });
    if (otpError) throw new Error(otpError.message);
  }, []);

  const verifyPhoneCode = useCallback(async (phone: string, code: string) => {
    if (!supabase) throw new Error('Live sign-in is not configured in this build.');
    const { error: verifyError } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (verifyError) throw new Error(verifyError.message);
  }, []);

  const signUp = useCallback(async (fullName: string, email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    setError(null);
    setIsLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), brand_slug: TENANT.identity.slug } },
    });
    setIsLoading(false);
    if (signUpError) throw new Error(signUpError.message);
  }, [setError, setIsLoading]);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: recoveryRedirectUrl(Linking.createURL),
    });
    if (resetError) throw new Error(resetError.message);
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw new Error(signOutError.message);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) throw new Error(updateError.message);
    setIsPasswordRecovery(false);
  }, [setIsPasswordRecovery]);

  return {
    requestPasswordReset,
    signIn,
    signInWithEmailOtp,
    signInWithPhone,
    signOut,
    signUp,
    updatePassword,
    verifyEmailCode,
    verifyPhoneCode,
  };
}
