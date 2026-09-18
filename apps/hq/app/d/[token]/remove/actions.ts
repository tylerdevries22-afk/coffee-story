'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { serverEnv, serviceDb } from '@/lib/api-auth';
import { DEMO_COOKIE } from '@/lib/demo-entry';
import { removeDemoSite } from '@/lib/demo-site';
import { isDemoToken } from '@/lib/demo-token';
import { log } from '@/lib/log';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';

const REMOVALS_PER_MINUTE = 10;

/**
 * "Remove my business", as a POST only. A GET that removed would be fired by
 * the link scanners mail providers run on every inbound email, deleting a
 * demo nobody asked to delete; a form post is a person pressing a button.
 * Next checks the Origin of every server action, so a third-party page cannot
 * post it on the visitor's behalf.
 */
export async function removeDemo(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!isDemoToken(token)) redirect('/d/view?link=invalid');
  if (rateLimited(clientIdentity({ headers: await headers() }), 'demo:remove', Date.now(), REMOVALS_PER_MINUTE)) {
    redirect(`/d/${token}/remove?status=busy`);
  }
  const env = serverEnv();
  if (!env) redirect(`/d/${token}/remove?status=unavailable`);
  let removed = false;
  try {
    removed = await removeDemoSite(serviceDb(env), token);
  } catch (error) {
    log.error('demo.remove_failed', {}, error);
    redirect(`/d/${token}/remove?status=unavailable`);
  }
  (await cookies()).delete(DEMO_COOKIE);
  redirect(removed ? '/d/removed' : `/d/${token}/remove?status=nothing`);
}
