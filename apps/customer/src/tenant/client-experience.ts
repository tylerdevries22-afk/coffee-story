import { clientExperienceForModules } from '@/features/client-experience';

import { TENANT_MODULE_KEYS } from './index';

/** The customer shell selected by this tenant's installed modules. */
export const TENANT_CLIENT_EXPERIENCE = clientExperienceForModules(TENANT_MODULE_KEYS);
