import { fetchBrandBySlug } from '@platform/data';
import { useCallback, useEffect, useRef, useState } from 'react';

import { kioskConfigOf, RETRY_MS, type KioskMenuStatus } from '@/data/menu-store-context';
import { supabase } from '@/lib/supabase';
import { TENANT_BRAND_CONFIG } from '@/tenant';

type BrandResolutionOptions = {
  deviceBrandId: string | null;
  deviceLocationId: string | null;
  setKioskConfig: (config: unknown) => void;
  setStatus: (status: KioskMenuStatus) => void;
};

/** Resolve the build tenant until pairing supplies an authoritative brand. */
export function useKioskBrand({
  deviceBrandId, deviceLocationId, setKioskConfig, setStatus,
}: BrandResolutionOptions) {
  const [resolvedBrandId, setResolvedBrandId] = useState<string | null>(null);
  const [resolvedLocationId, setResolvedLocationId] = useState<string | null>(null);
  const failures = useRef(0);
  const [retrySequence, setRetrySequence] = useState(0);

  const retry = useCallback(() => {
    failures.current = 0;
    setRetrySequence((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!supabase || deviceBrandId !== null || resolvedBrandId !== null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void fetchBrandBySlug(supabase, TENANT_BRAND_CONFIG.identity.slug)
      .then((summary) => {
        if (!alive) return;
        if (!summary) throw new Error('The configured brand is unavailable.');
        failures.current = 0;
        setStatus('loading');
        setKioskConfig(kioskConfigOf(summary.brand.brand_config));
        setResolvedBrandId(summary.brand.id);
        setResolvedLocationId(summary.locations[0]?.id ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setStatus('unavailable');
        const wait = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)] ?? 60_000;
        failures.current += 1;
        timer = setTimeout(() => setRetrySequence((value) => value + 1), wait);
      });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [deviceBrandId, resolvedBrandId, retrySequence, setKioskConfig, setStatus]);

  return {
    brandId: deviceBrandId ?? resolvedBrandId,
    locationId: deviceLocationId ?? resolvedLocationId,
    retry,
  };
}
