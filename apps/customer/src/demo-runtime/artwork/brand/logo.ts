/* eslint-disable import/no-unresolved -- resolved directly, not through @tenant-bundle (see below). */
import neutralLogo from '../../../../assets/tenants/juniper-base-demo/brand/logo.png';

import { demoPack, logoSourceOf } from '../../pack';

/**
 * The pack's own logo when it has one, the neutral reference tenant's
 * otherwise. This import is a real relative path rather than
 * `@tenant-bundle/artwork/brand/logo.png`: that specifier is what resolves
 * to this very file in demo runtime mode (see
 * scripts/lib/tenant-bundle-resolver.js's demoRuntimeBundlePath), so reusing
 * it here would resolve back to itself.
 */
export default logoSourceOf(demoPack(), neutralLogo);
