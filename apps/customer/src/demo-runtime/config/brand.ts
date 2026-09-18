import { demoPack } from '../pack';

/** Whatever GET /d/pack.json validated with parseTenantManifest, unchanged. */
export default demoPack().brand ?? {};
