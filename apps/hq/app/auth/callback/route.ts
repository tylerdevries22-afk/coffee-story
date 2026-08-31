import { NextResponse } from 'next/server';

import { serverClient } from '@/lib/supabase-server';

const SAFE_NEXT = /^\/[a-z0-9/_-]*$/;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';
  const destination = SAFE_NEXT.test(next) && !next.startsWith('//') ? next : '/';
  const client = await serverClient();
  if (!client || !code) return NextResponse.redirect(new URL('/login?error=invite', url));
  const result = await client.auth.exchangeCodeForSession(code);
  if (result.error) return NextResponse.redirect(new URL('/login?error=invite', url));
  return NextResponse.redirect(new URL(destination, url));
}
