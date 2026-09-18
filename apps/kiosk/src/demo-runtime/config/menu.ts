import { demoPack } from '../pack';

/** Whatever GET /d/pack.json reshaped into the tenant menu.json shape. */
export default demoPack().menu ?? { version: 1, categories: [], items: [] };
