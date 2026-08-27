import { AppState } from 'react-native';
import { useEffect, useState } from 'react';
import { coffeeStoryTrainingManifest, type TrainingManifest } from '@platform/domain';
import { subscribeToTrainingReleases } from '@platform/data';

import { mobileApi } from '@/lib/mobile-api';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';

export type OperatorTrainingRelease = { id: string; manifest: TrainingManifest };

const DEMO_TRAINING_RELEASE: OperatorTrainingRelease = {
  id: 'demo-coffee-story-training-v1',
  manifest: coffeeStoryTrainingManifest({
    businessName: 'Coffee Story',
    industry: 'Coffee shop',
    locale: 'en-US',
    templateKey: 'coffee-story',
    templateVersion: 1,
  }),
};

export function useTrainingRelease(): { release: OperatorTrainingRelease | null; loading: boolean; error: string | null; isDemo: boolean } {
  const { isDemo, tenant, isAuthenticated } = useAuth();
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
    if (isDemo) { setRelease(DEMO_TRAINING_RELEASE); setLoading(false); return undefined; }
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
  }, [brandId, isAuthenticated, isDemo]);
  // Effects run after paint. Guard the render result as well so a tenant
  // switch cannot display the prior brand's release for one frame.
  const visibleRelease = isDemo ? DEMO_TRAINING_RELEASE : releaseBrandId === brandId ? release : null;
  return { release: visibleRelease, loading, error, isDemo };
}
