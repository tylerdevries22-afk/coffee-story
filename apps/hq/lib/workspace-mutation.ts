/** Selected-tenant writes need a separate audited support flow. */
export function mayMutateSelectedOrganization(
  homeOrganizationId: string,
  selectedOrganizationId: string,
): boolean {
  return homeOrganizationId === selectedOrganizationId;
}
