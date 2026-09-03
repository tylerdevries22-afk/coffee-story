import 'server-only';

/**
 * The selected brand's console capabilities, for a page that has to gate its
 * own body.
 *
 * Hiding a rail entry is not gating: the route is still typed into an address
 * bar, linked from a bookmark, or reached by a back button after a module is
 * uninstalled. The nav answers "is this worth showing"; this answers "may this
 * be rendered", from the same request-scoped resolve, so a page that asks
 * costs no extra query.
 *
 * It is still not the authorization boundary. Every row these pages read comes
 * back under the caller's own RLS, and every write behind them is re-checked
 * server side. This stops a console from claiming a capability its tenant does
 * not hold.
 */
import { currentSession } from './auth';
import {
  activeModuleKeys,
  consoleCapabilitiesOf,
  type ConsoleCapabilities,
} from './capabilities';
import { selectedOrganizationId } from './workspace-scope';

export async function selectedConsoleCapabilities(): Promise<ConsoleCapabilities> {
  const session = await currentSession();
  // No session is not the same as no capability, but it is the same outcome:
  // resolveModuleKeys denies a configured deployment with no brand in scope,
  // and demo mode has already answered before this is reached.
  const brandId = session ? await selectedOrganizationId(session) : null;
  return consoleCapabilitiesOf(await activeModuleKeys(brandId));
}
