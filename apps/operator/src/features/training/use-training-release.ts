import { AppState } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { cafeTrainingManifest, constructionTrainingManifest, isConstructionTrainingProfile, type TenantTrainingProfile, type TrainingManifest } from '@platform/domain';
import { subscribeToTrainingReleases } from '@platform/data';

import { mobileApi } from '@/lib/mobile-api';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';
import { DEMO_TRAINING_PROFILE, trainingProfileFromBrandConfig } from './training-profile';

export type OperatorTrainingRelease = { id: string; manifest: TrainingManifest };
const UNIDENTIFIED_TRAINING_PROFILE: TenantTrainingProfile = {
  businessName: 'business', industry: '', locale: 'en-US',
};

function demoTrainingRelease(profile: TenantTrainingProfile): OperatorTrainingRelease {
  const manifest = isConstructionTrainingProfile(profile)
    ? constructionTrainingManifest(profile)
    : cafeTrainingManifest(profile);
  return { id: 'demo-training-v1', manifest };
}

export type TrainingReleaseState = {
  release: OperatorTrainingRelease | null;
  profile: TenantTrainingProfile;
  loading: boolean;
  error: string | null;
  isDemo: boolean;
};

export function useTrainingRelease(): TrainingReleaseState {
  const { isDemo, tenant, isAuthenticated, brandName, brandConfig } = useAuth();
  const fallbackProfile = isDemo ? DEMO_TRAINING_PROFILE : UNIDENTIFIED_TRAINING_PROFILE;
  const configuredProfile = useMemo(() => trainingProfileFromBrandConfig(
    brandConfig, brandName, fallbackProfile,
  ), [brandConfig, brandName, fallbackProfile]);
  const demoRelease = useMemo(() => demoTrainingRelease(configuredProfile), [configuredProfile]);
  const brandId = tenant?.brand_id ?? null;
  const [release, setRelease] = useState<OperatorTrainingRelease | null>(null);
  const [releaseBrandId, setReleaseBrandId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // A tenant boundary is also a data boundary: never render the previous
    // brand's curriculum while a new JWT/release is being resolved.
    setRelease(null);
    setReleaseBrandId(null);
    setError(null);
    if (isDemo) { setRelease(demoRelease); setLoading(false); return undefined; }
    if (!brandId) {
      setLoading(false);
      if (isAuthenticated) setError('This account has no tenant training access.');
      return undefined;
    }
    let mounted = true;
    let unsubscribe = () => {};
    const load = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      try {
        const value = await mobileApi.trainingRelease();
        if (mounted) { setRelease(value); setReleaseBrandId(brandId); setError(null); }
      } catch {
        if (mounted) setError('Training is temporarily unavailable.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load(true);
    const connect = async () => {
      if (!supabase) return;
      if (mounted) unsubscribe = subscribeToTrainingReleases(supabase, brandId, () => { void load(false); });
    };
    void connect();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load(false);
    });
    return () => { mounted = false; unsubscribe(); appState.remove(); };
  }, [brandId, demoRelease, isAuthenticated, isDemo]);
  // Effects run after paint. Guard the render result as well so a tenant
  // switch cannot display the prior brand's release for one frame.
  const visibleRelease = isDemo ? demoRelease : releaseBrandId === brandId ? release : null;
  const profile = visibleRelease?.manifest.tenant ?? configuredProfile;
  return { release: visibleRelease, profile, loading, error, isDemo };
}
