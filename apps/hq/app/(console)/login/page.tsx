import { redirect } from 'next/navigation';

import { isConfigured } from '@/lib/supabase-server';

import { requestEmailCode, signInWithPassword, verifyEmailCode } from './actions';

// Decided per request, never at build: the unconfigured-redirect below runs
// before searchParams is touched, so `next build` on an unconfigured machine
// would otherwise bake redirect('/') into a static /login — and a configured
// deployment then loops forever between the middleware's gate and that baked
// redirect.
export const dynamic = 'force-dynamic';

/**
 * Console sign-in. Unconfigured deployments never land here (middleware is
 * a no-op and the console runs on the demo session); if someone navigates
 * anyway, send them back to the demo console.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; email?: string }>;
}) {
  if (!isConfigured()) redirect('/');
  const params = await searchParams;
  const sent = params.sent === '1';
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Sign in</h1>
        <p className="subtitle">The console for your shop&rsquo;s menu, drops, and numbers.</p>
        {params.error ? <div className="notice" role="alert">{params.error}</div> : null}

        {sent ? (
          <form action={verifyEmailCode} className="login-form">
            <p className="subtitle">We emailed a six-digit code to {params.email ?? 'your address'}.</p>
            <input type="hidden" name="email" value={params.email ?? ''} />
            <label>
              Six-digit code
              <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
            </label>
            <button type="submit">Verify and sign in</button>
            <a className="login-alt" href="/login">Start over</a>
          </form>
        ) : (
          <>
            <form action={signInWithPassword} className="login-form">
              <label>
                Email
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <label>
                Password
                <input name="password" type="password" autoComplete="current-password" required />
              </label>
              <button type="submit">Sign in</button>
            </form>
            <form action={requestEmailCode} className="login-form login-form-alt">
              <label>
                Or get a sign-in code by email
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <button type="submit" className="secondary">Email me a code</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
