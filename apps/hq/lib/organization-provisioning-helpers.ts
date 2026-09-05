export function organizationInvitationUrl(environment: {
  readonly hqUrl?: string;
  readonly vercelEnvironment?: string;
  readonly vercelUrl?: string;
}): string | null {
  const preview = environment.vercelEnvironment === 'preview' && environment.vercelUrl
    ? `https://${environment.vercelUrl}` : null;
  const configured = preview ?? environment.hqUrl;
  if (!configured) return null;
  try {
    const url = new URL('/auth/callback?next=/', configured);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    return url.protocol === 'https:' || local ? url.toString() : null;
  } catch {
    return null;
  }
}

export function organizationFailure(message: string): string {
  if (message.includes('franchise_network_not_found')) return 'That franchise network was not found.';
  if (message.includes('brands_slug_key') || message.includes('duplicate key')) {
    return 'That organization handle is already in use.';
  }
  return 'The organization could not be provisioned. No partial tenant was activated.';
}

type InvitationAdmin = { deleteUser(id: string): Promise<{ error: { message: string } | null }> };
type InvitationOwner = { readonly userId: string; readonly invited: boolean };

async function deleteWithTimeout(admin: InvitationAdmin, userId: string, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      admin.deleteUser(userId),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function rollbackInvitation(
  admin: InvitationAdmin,
  owner: InvitationOwner,
  timeoutMs = 5_000,
): Promise<void> {
  if (!owner.invited) return;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await deleteWithTimeout(admin, owner.userId, timeoutMs);
      if (!result.error) return;
    } catch {
      // Retry once so a transient Auth Admin failure does not orphan an invitation.
    }
  }
  throw new Error('invitation_rollback_failed');
}

export async function rollbackInvitationSafely(
  admin: InvitationAdmin,
  owner: InvitationOwner,
  report: (message: string) => void = console.error,
): Promise<void> {
  try { await rollbackInvitation(admin, owner); } catch {
    report(JSON.stringify({ severity: 'error', component: 'organization-provisioning',
      event: 'owner.invitation_rollback_failed', ownerId: owner.userId }));
  }
}

export async function reconcileUnknownProvisioningInvitation(
  admin: InvitationAdmin,
  owner: InvitationOwner,
  readback: PromiseLike<{ data: { brand_id?: unknown } | null; error: unknown }>,
  report: (message: string) => void = console.error,
): Promise<void> {
  try {
    const result = await readback;
    if (!result.error && !result.data) return rollbackInvitationSafely(admin, owner, report);
    if (!result.error) return;
  } catch {
    // A lost response may have committed; never delete its owner without readback proof.
  }
  report(JSON.stringify({ severity: 'error', component: 'organization-provisioning',
    event: 'owner.invitation_commit_unknown', ownerId: owner.userId }));
}
