/** Hosted org → surface URL map for the static preview wall publisher. */
export type WallHostSurfaces = Readonly<Record<string, string>>;

export type WallOrganizationHost = {
  readonly tenantKey: string;
  readonly organizationName: string;
  readonly surfaces: WallHostSurfaces;
};

/** Model B path URLs on the org HQ host; display stays dedicated. */
export function modelBWallSurfaces(tenantKey: string): WallHostSurfaces {
  const hq = `https://${tenantKey}-hq.vercel.app`;
  return {
    display: `https://${tenantKey}-display.vercel.app/`,
    hq: `${hq}/`,
    'kiosk-web': `${hq}/kiosk`,
    'operator-web': `${hq}/operator`,
    'customer-web': `${hq}/customer`,
  };
}

function titleizeSlug(slug: string): string {
  return slug.split('-').filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
}

/** Hosted wall catalog is env-driven. Unset = empty (never invent Coffee Story). */
export function hostedWallOrganizations(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): readonly WallOrganizationHost[] {
  const raw = environment.WALL_HOSTED_TENANTS ?? environment.EXPO_PUBLIC_TENANT ?? '';
  const keys = raw.split(',').map((key) => key.trim()).filter(Boolean);
  return keys.map((tenantKey) => ({
    tenantKey,
    organizationName: titleizeSlug(tenantKey),
    surfaces: modelBWallSurfaces(tenantKey),
  }));
}

export function localWallOrganization(
  tenantKey: string,
  organizationName: string,
  surfaces: { launch: string; port: number; path: string }[],
): WallOrganizationHost {
  return {
    tenantKey,
    organizationName,
    surfaces: Object.fromEntries(
      surfaces.map((surface) => [surface.launch, `http://127.0.0.1:${surface.port}${surface.path}`]),
    ),
  };
}

/** Attach hosted + local org catalog to a published wall payload. */
export function wallDocumentWithOrganizations<T extends {
  context: { tenantKey: string; organizationName: string };
  surfaces: Parameters<typeof localWallOrganization>[2];
}>(publishedWall: T): T & { organizations: ReturnType<typeof hostedWallOrganizations> } {
  const localOrg = localWallOrganization(
    publishedWall.context.tenantKey,
    `${publishedWall.context.organizationName} (local)`,
    publishedWall.surfaces,
  );
  const hosted = [...hostedWallOrganizations()];
  const preferred = hosted.find((org) => org.tenantKey === publishedWall.context.tenantKey);
  const context = preferred
    ? { tenantKey: preferred.tenantKey, organizationName: preferred.organizationName }
    : publishedWall.context;
  return { ...publishedWall, context, organizations: [...hosted, localOrg] };
}
