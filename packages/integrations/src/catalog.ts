import { entry, type CatalogDefinition } from './catalog-definition';
import { AUDIENCE_DEFINITIONS } from './catalog-audience';
import { COMMERCE_DEFINITIONS } from './catalog-commerce';
import { MESSAGING_DEFINITIONS } from './catalog-messaging';
import { PLANNED_DEFINITIONS } from './catalog-planned';
import { PLATFORM_DEFINITIONS } from './catalog-platform';
import { PUBLISHING_DEFINITIONS } from './catalog-publishing';
import type { ConnectorAvailability, ConnectorCatalogEntry } from './contracts';

export { API_VERSION } from './catalog-definition';

const DEFINITIONS: readonly CatalogDefinition[] = [
  ...MESSAGING_DEFINITIONS,
  ...COMMERCE_DEFINITIONS,
  ...AUDIENCE_DEFINITIONS,
  ...PUBLISHING_DEFINITIONS,
  ...PLATFORM_DEFINITIONS,
  ...PLANNED_DEFINITIONS,
];

export const OPERATIONS_CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] =
  Object.freeze(DEFINITIONS.map(entry));

export function listConnectorCatalog(): readonly ConnectorCatalogEntry[] {
  return OPERATIONS_CONNECTOR_CATALOG;
}

export function getConnectorCatalogEntry(id: string): ConnectorCatalogEntry | undefined {
  return OPERATIONS_CONNECTOR_CATALOG.find((catalogEntry) => catalogEntry.descriptor.id === id);
}

export function listConnectorsByAvailability(
  availability: ConnectorAvailability,
): readonly ConnectorCatalogEntry[] {
  return OPERATIONS_CONNECTOR_CATALOG.filter((catalogEntry) => catalogEntry.availability === availability);
}
