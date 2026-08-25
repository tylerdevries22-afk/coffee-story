import { createHash } from 'node:crypto';
import type { TenantTrainingProfile } from '@platform/domain';

import { normalizeTrainingProfile } from './training-bootstrap';

export function trainingProfileFingerprint(profile: TenantTrainingProfile): string {
  return createHash('sha256').update(JSON.stringify(normalizeTrainingProfile(profile))).digest('hex');
}
