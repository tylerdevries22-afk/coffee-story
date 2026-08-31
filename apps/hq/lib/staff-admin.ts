type AuthUser = { id: string; email?: string | null };
type AuthError = { message: string } | null;

export type StaffAuthAdmin = {
  inviteUserByEmail: (
    email: string,
    options: { redirectTo: string },
  ) => Promise<{ data: { user: AuthUser | null }; error: AuthError }>;
  listUsers: (
    options: { page: number; perPage: number },
  ) => Promise<{ data: { users: AuthUser[] }; error: AuthError }>;
};

const PAGE_SIZE = 200;
const MAX_PAGES = 100;

export function staffInvitationRedirectUrl(environment: {
  hqUrl?: string;
  vercelEnvironment?: string;
  vercelUrl?: string;
}): string | null {
  const preview = environment.vercelEnvironment === 'preview' && environment.vercelUrl
    ? `https://${environment.vercelUrl}` : null;
  const configured = preview ?? environment.hqUrl;
  if (!configured) return null;
  try {
    const url = new URL('/auth/callback?next=/staff', configured);
    const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    return url.protocol === 'https:' || local ? url.toString() : null;
  } catch {
    return null;
  }
}

export class StaffAdminError extends Error {
  constructor(readonly code: 'auth_lookup_failed' | 'auth_directory_too_large' | 'invite_failed') {
    super(code);
  }
}

/** Exact, server-only email lookup over the paginated Auth Admin directory. */
export async function findAuthUserByEmail(
  admin: StaffAuthAdmin,
  email: string,
): Promise<AuthUser | null> {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await admin.listUsers({ page, perPage: PAGE_SIZE });
    if (result.error) throw new StaffAdminError('auth_lookup_failed');
    const found = result.data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (result.data.users.length < PAGE_SIZE) return null;
  }
  throw new StaffAdminError('auth_directory_too_large');
}

export async function resolveOrInviteStaffUser(
  admin: StaffAuthAdmin,
  email: string,
  redirectTo: string,
): Promise<{ userId: string; invited: boolean }> {
  const existing = await findAuthUserByEmail(admin, email);
  if (existing) return { userId: existing.id, invited: false };
  const result = await admin.inviteUserByEmail(email, { redirectTo });
  if (result.error || !result.data.user) throw new StaffAdminError('invite_failed');
  return { userId: result.data.user.id, invited: true };
}

/** Loads only requested identities; no caller receives the whole auth directory. */
export async function emailsForUserIds(
  admin: StaffAuthAdmin,
  userIds: ReadonlySet<string>,
): Promise<ReadonlyMap<string, string>> {
  if (userIds.size === 0) return new Map();
  const emails = new Map<string, string>();
  for (let page = 1; page <= MAX_PAGES && emails.size < userIds.size; page += 1) {
    const result = await admin.listUsers({ page, perPage: PAGE_SIZE });
    if (result.error) throw new StaffAdminError('auth_lookup_failed');
    for (const user of result.data.users) {
      if (userIds.has(user.id) && user.email) emails.set(user.id, user.email);
    }
    if (result.data.users.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) throw new StaffAdminError('auth_directory_too_large');
  }
  return emails;
}
