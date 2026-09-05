/** Rich launch fixtures belong only to the launch organization. */
export function usesLaunchFixtures(
  selectedOrganizationId: string | null,
  launchOrganizationId: string,
): boolean {
  return selectedOrganizationId === null || selectedOrganizationId === launchOrganizationId;
}
