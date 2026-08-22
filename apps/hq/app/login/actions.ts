'use server';

/**
 * Sign-in for the console, as plain server actions: no client JS, errors and
 * steps ride the query string. Password is primary for staff; a six-digit
 * email code works for accounts without one. shouldCreateUser stays false —
 * console sign-in never mints new accounts; the owner adds staff, the claims
 * hook gives them their role.
 */
import { redirect } from 'next/navigation';

import { serverClient } from '@/lib/supabase-server';

function loginError(message: string): never {
  redirect(`/login?error=${encodeURIComponent(message)}`);
}

export async function signInWithPassword(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email.includes('@') || !password) loginError('Enter your email and password.');
  const client = await serverClient();
  if (!client) loginError('This deployment has no Supabase configuration.');
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) loginError(error.message);
  redirect('/');
}

export async function requestEmailCode(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email.includes('@')) loginError('Enter a valid email address.');
  const client = await serverClient();
  if (!client) loginError('This deployment has no Supabase configuration.');
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) loginError(error.message);
  redirect(`/login?sent=1&email=${encodeURIComponent(email)}`);
}

export async function verifyEmailCode(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  if (!/^\d{6}$/.test(code)) redirect(`/login?sent=1&email=${encodeURIComponent(email)}&error=${encodeURIComponent('Enter the six-digit code from the email.')}`);
  const client = await serverClient();
  if (!client) loginError('This deployment has no Supabase configuration.');
  const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) redirect(`/login?sent=1&email=${encodeURIComponent(email)}&error=${encodeURIComponent(error.message)}`);
  redirect('/');
}

export async function signOut(): Promise<void> {
  const client = await serverClient();
  if (client) await client.auth.signOut();
  redirect('/login');
}
