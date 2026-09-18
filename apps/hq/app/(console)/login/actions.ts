'use server';

/**
 * Sign-in for the console, as plain server actions: no client JS, errors and
 * steps ride the query string. Password is primary for staff; a six-digit
 * email code works for accounts without one. shouldCreateUser stays false —
 * console sign-in never mints new accounts; the owner adds staff, the claims
 * hook gives them their role.
 */
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';

import { clientIdentity, rateLimited } from '@/lib/rate-limit';
import { serverClient } from '@/lib/supabase-server';
import {
  expiredWorkspaceCookieOptions,
  LOCATION_COOKIE,
  ORG_COOKIE,
} from '@/lib/workspace-cookie';

/**
 * Attempts per caller per minute, per action. GoTrue has limits of its own,
 * but they are project-wide: one caller could spend the whole project's email
 * budget, or trip the sign-in limit for everyone, before they engage. These
 * bound a single caller's burst on this instance; lib/rate-limit.ts says what
 * they are not.
 */
const LOGIN_LIMITS = { password: 10, code: 5, verify: 10 } as const;

const TOO_MANY = 'Too many attempts. Wait a minute and try again.';

async function throttled(action: keyof typeof LOGIN_LIMITS): Promise<boolean> {
  return rateLimited(clientIdentity({ headers: await headers() }), `login:${action}`,
    Date.now(), LOGIN_LIMITS[action]);
}

function loginError(message: string): never {
  redirect(`/login?error=${encodeURIComponent(message)}`);
}

export async function signInWithPassword(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (await throttled('password')) loginError(TOO_MANY);
  if (!email.includes('@') || !password) loginError('Enter your email and password.');
  const client = await serverClient();
  if (!client) loginError('This deployment has no Supabase configuration.');
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) loginError(error.message);
  redirect('/');
}

export async function requestEmailCode(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  if (await throttled('code')) loginError(TOO_MANY);
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
  // Stays on the code step: the email is still on its way, so starting over
  // would only send another one.
  const retry = (message: string): never =>
    redirect(`/login?sent=1&email=${encodeURIComponent(email)}&error=${encodeURIComponent(message)}`);
  if (await throttled('verify')) retry(TOO_MANY);
  if (!/^\d{6}$/.test(code)) retry('Enter the six-digit code from the email.');
  const client = await serverClient();
  if (!client) loginError('This deployment has no Supabase configuration.');
  const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) retry(error.message);
  redirect('/');
}

export async function signOut(): Promise<void> {
  const client = await serverClient();
  try {
    if (client) await client.auth.signOut();
  } catch {
    // Local workspace scope still has to disappear when auth is unavailable.
  }
  const store = await cookies();
  const expired = expiredWorkspaceCookieOptions();
  store.set(ORG_COOKIE, '', expired);
  store.set(LOCATION_COOKIE, '', expired);
  redirect('/login');
}
