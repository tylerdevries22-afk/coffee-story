import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { useCallback, type Dispatch, type SetStateAction } from 'react';

import { recoveryRedirectUrl } from '@platform/domain';
import { wipePrintOutboxes } from '@/features/operator/print-outbox-storage';
import { printSecureStorage } from '@/features/operator/print-secure-store';
import { supabase } from '@/lib/supabase';

export function useAuthActions({ setError, setIsLoading, setIsPasswordRecovery }: {
  setError: Dispatch<SetStateAction<string | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsPasswordRecovery: Dispatch<SetStateAction<boolean>>;
}) {
  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    setError(null);
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setIsLoading(false); throw new Error(error.message); }
  }, [setError, setIsLoading]);
  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: recoveryRedirectUrl(Linking.createURL),
    });
    if (error) throw new Error(error.message);
  }, []);
  const signOut = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.');
    await wipePrintOutboxes(AsyncStorage, printSecureStorage);
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }, []);
  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    setIsPasswordRecovery(false);
  }, [setIsPasswordRecovery]);
  return { requestPasswordReset, signIn, signOut, updatePassword };
}
