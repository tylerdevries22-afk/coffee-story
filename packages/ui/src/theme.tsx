/**
 * Hydrates tokens + copy from the tenant's brand config and caches the last
 * good config so a cold start away from the network still opens branded.
 *
 * Storage is injected rather than imported: the Expo apps pass an
 * AsyncStorage-shaped adapter, web passes localStorage, tests pass a Map.
 * The provider never throws on storage failure -- worst case is defaults
 * until `brandConfig` arrives.
 */
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { formatCopy, resolveCopy, type BrandCopy } from './copy.ts';
import { resolveTokens, type BrandTokens, DEFAULT_TOKENS } from './tokens.ts';

export type TokenStorage = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
};

const CACHE_KEY = 'platform.brand-config.v1';

type ThemeValue = {
  tokens: BrandTokens;
  copy: BrandCopy;
  /** True once either the cache or a live config has been applied. */
  hydrated: boolean;
};

const ThemeContext = createContext<ThemeValue>({
  tokens: DEFAULT_TOKENS,
  copy: resolveCopy(null),
  hydrated: false,
});

export function ThemeProvider({
  brandConfig,
  storage,
  children,
}: PropsWithChildren<{
  /** The tenant's brand_config: bundled brand.json at boot, brand row once fetched. */
  brandConfig?: unknown;
  storage?: TokenStorage;
}>) {
  const [cached, setCached] = useState<unknown>(null);
  const [cacheChecked, setCacheChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await storage?.getItem(CACHE_KEY);
        if (alive && raw) setCached(JSON.parse(raw));
      } catch {
        // A corrupt cache entry is the same as no cache entry.
      } finally {
        if (alive) setCacheChecked(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [storage]);

  useEffect(() => {
    if (brandConfig === undefined || brandConfig === null) return;
    try {
      void storage?.setItem(CACHE_KEY, JSON.stringify(brandConfig));
    } catch {
      // Caching is a convenience; hydration already happened from the prop.
    }
  }, [brandConfig, storage]);

  const active = brandConfig ?? cached;
  const value = useMemo<ThemeValue>(() => {
    const source = (typeof active === 'object' && active !== null ? active : {}) as Record<string, unknown>;
    return {
      tokens: resolveTokens(source.tokens),
      copy: resolveCopy(source.copy),
      hydrated: active != null || cacheChecked,
    };
  }, [active, cacheChecked]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

export function useTokens(): BrandTokens {
  return useContext(ThemeContext).tokens;
}

/** `copyText('earnBanner', { points: 96 })` bound to the active dictionary. */
export function useCopy(): (key: string, params?: Record<string, string | number>) => string {
  const { copy } = useContext(ThemeContext);
  return (key, params) => formatCopy(copy, key, params ?? {});
}
