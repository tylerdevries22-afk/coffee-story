/* eslint-disable import/no-unresolved -- Metro resolves @tenant-bundle/neutral. */
import neutralLogo from '@tenant-bundle/neutral/brand/logo.png';

import { demoPack, logoSourceOf } from '../../pack';

/**
 * The pack's own logo when it has one, the neutral reference tenant's
 * otherwise. `@tenant-bundle/neutral/...` is a dedicated specifier rather
 * than `@tenant-bundle/artwork/brand/logo.png`: that one resolves to this
 * very file in demo runtime mode (see scripts/lib/tenant-bundle-resolver.js's
 * demoRuntimeBundlePath), so reusing it here would resolve back to itself.
 * The neutral tenant's own slug lives only in tenant-bundle-resolver.js.
 */
export default logoSourceOf(demoPack(), neutralLogo);
