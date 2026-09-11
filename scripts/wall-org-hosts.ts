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
    display: `https://${tenantKey}-display.vercel.app/board/demo`,
    hq: `${hq}/`,
    'kiosk-web': `${hq}/kiosk`,
    'operator-web': `${hq}/operator`,
    'customer-web': `${hq}/customer`,
  };
}

const COFFEE_STORY: WallOrganizationHost = {
  tenantKey: 'coffee-story',
  organizationName: 'Coffee Story',
  surfaces: modelBWallSurfaces('coffee-story'),
};

export function hostedWallOrganizations(): readonly WallOrganizationHost[] {
  return [COFFEE_STORY];
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
