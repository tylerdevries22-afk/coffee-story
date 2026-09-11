/** Model B path URLs for the HQ Vercel project env map. */
export function modelBHqSurfaceUrls(tenantSlug: string, hqUrl: string): Record<string, string> {
  return {
    NEXT_PUBLIC_ORG_SURFACE_ORIGIN: hqUrl,
    NEXT_PUBLIC_HQ_URL: hqUrl,
    NEXT_PUBLIC_CUSTOMER_URL: `${hqUrl}/customer`,
    NEXT_PUBLIC_KIOSK_URL: `${hqUrl}/kiosk`,
    NEXT_PUBLIC_OPERATOR_URL: `${hqUrl}/operator`,
    NEXT_PUBLIC_DISPLAY_URL: `https://${tenantSlug}-display.vercel.app`,
  };
}
