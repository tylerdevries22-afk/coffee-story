import type { AppRole, PortalSetupState } from '@platform/domain';

/** Facts for the "already set up" review card. */
export function setupSummary(role: AppRole, setup: PortalSetupState): { label: string; value: string }[] {
  if (role === 'client') {
    const { answers } = setup.client;
    return [
      { label: 'Goals', value: answers.goals.length ? answers.goals.slice(0, 2).join(', ') : '—' },
      { label: 'Pressure', value: answers.pressure },
      { label: 'Best times', value: answers.preferredTimes.length ? answers.preferredTimes.slice(0, 2).join(', ') : 'Flexible' },
    ];
  }
  if (role === 'staff') {
    const { answers } = setup.staff;
    return [
      { label: 'Specialties', value: answers.specialties.length ? answers.specialties.slice(0, 2).join(', ') : '—' },
      { label: 'Days available', value: answers.workingDays.length ? `${answers.workingDays.length} of 7` : '—' },
    ];
  }
  const { answers } = setup.admin;
  return [
    { label: 'Studio', value: answers.businessName || '—' },
    { label: 'Open days', value: answers.openDays.length ? `${answers.openDays.length} of 7` : '—' },
    { label: 'Online booking', value: answers.onlineOrdering ? 'On' : 'Off' },
  ];
}

export function toggleListItem(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}
