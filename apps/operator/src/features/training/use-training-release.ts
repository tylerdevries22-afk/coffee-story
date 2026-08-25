import { useEffect, useState } from 'react';
import type { TrainingManifest } from '@platform/domain';

import { mobileApi } from '@/lib/mobile-api';
import { useAuth } from '@/state/auth-context';

export type OperatorTrainingRelease = { id: string; manifest: TrainingManifest };

export function useTrainingRelease(): { release: OperatorTrainingRelease | null; loading: boolean; error: string | null; isDemo: boolean } {
  const { isDemo } = useAuth();
  const [release, setRelease] = useState<OperatorTrainingRelease | null>(null);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isDemo) { setLoading(false); return undefined; }
    let mounted = true;
    void mobileApi.trainingRelease().then((value) => {
      if (mounted) setRelease(value);
    }).catch(() => {
      if (mounted) setError('Training is temporarily unavailable.');
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [isDemo]);
  return { release, loading, error, isDemo };
}
