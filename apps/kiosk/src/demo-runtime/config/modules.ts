import { demoPack } from '../pack';

/** Whatever GET /d/pack.json validated with parseTenantModulesManifest. */
export default demoPack().modules ?? { schemaVersion: 1, modules: [] };
