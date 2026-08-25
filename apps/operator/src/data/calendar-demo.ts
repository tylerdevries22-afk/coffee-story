import type { CalendarItem } from '@/features/calendar/presentation';

const people = {
  alex: { id: 'alex', name: 'Alex Morgan', initials: 'AM' },
  jordan: { id: 'jordan', name: 'Jordan Lee', initials: 'JL' },
  sam: { id: 'sam', name: 'Sam Rivera', initials: 'SR' },
} as const;

/** Tenant-neutral fixtures; live adapters replace these without changing UI. */
export const CALENDAR_ITEMS: readonly CalendarItem[] = [
  {
    id: 'morning-shift', category: 'scheduled_shift', title: 'Morning service', summary: 'Open and run the morning service window.',
    date: 'today', startTime: '7:00 AM', endTime: '1:00 PM', location: 'Main location', project: 'Store operations', status: 'Confirmed',
    assignees: [people.alex, people.jordan], primaryAction: 'View shift',
    sections: [
      { title: 'Shift details', rows: [{ label: 'Role', value: 'Opening team' }, { label: 'Break', value: '30 minutes' }] },
      { title: 'Assigned duties', rows: [{ label: 'Opening', value: 'Complete opening checklist' }, { label: 'Handoff', value: 'Update the afternoon lead' }] },
    ],
  },
  {
    id: 'spring-launch', category: 'project', title: 'Seasonal menu launch', summary: 'Finalize the service plan and launch materials.',
    date: 'today', startTime: '10:30 AM', endTime: '11:30 AM', location: 'Main location', project: 'Seasonal launch', status: 'In progress',
    assignees: [people.jordan, people.sam], primaryAction: 'Update project',
    sections: [
      { title: 'Milestones', rows: [{ label: 'Current', value: 'Team walkthrough' }, { label: 'Next', value: 'Go-live review' }] },
      { title: 'Resources', rows: [{ label: 'Files', value: '4 launch documents' }, { label: 'Dependencies', value: 'Menu and inventory ready' }] },
    ],
  },
  {
    id: 'safety-training', category: 'training', title: 'Safety refresher', summary: 'Review workplace safety and complete the knowledge check.',
    date: 'today', startTime: '2:00 PM', endTime: '2:30 PM', location: 'Online', project: 'Core training', status: 'Not started',
    assignees: [people.alex], primaryAction: 'Start training',
    sections: [
      { title: 'Learning plan', rows: [{ label: 'Lessons', value: '3 lessons' }, { label: 'Estimated time', value: '25 minutes' }] },
      { title: 'Certification', rows: [{ label: 'Passing score', value: '80%' }, { label: 'Attempts', value: '3 available' }] },
    ],
  },
  {
    id: 'opening-checklist', category: 'task', title: 'Opening checklist', summary: 'Complete and document all opening readiness checks.',
    date: 'tomorrow', startTime: '6:30 AM', endTime: '7:00 AM', location: 'Main location', project: 'Store operations', status: 'Assigned',
    assignees: [people.sam], primaryAction: 'Start task',
    sections: [
      { title: 'Checklist', rows: [{ label: 'Progress', value: '0 of 8 complete' }, { label: 'Evidence', value: 'Photo required' }] },
      { title: 'Instructions', rows: [{ label: 'Priority', value: 'High' }, { label: 'Dependency', value: 'Building access' }] },
    ],
  },
  {
    id: 'scheduled-order', category: 'order', title: 'Scheduled group order', summary: 'Prepare the confirmed pickup order for the guest.',
    date: 'tomorrow', startTime: '11:45 AM', endTime: '12:15 PM', location: 'Main location', project: 'Orders', status: 'Confirmed',
    assignees: [people.alex, people.sam], primaryAction: 'View order',
    sections: [
      { title: 'Fulfillment', rows: [{ label: 'Method', value: 'Pickup' }, { label: 'Items', value: '18 items' }] },
      { title: 'Preparation', rows: [{ label: 'Status', value: 'Queued' }, { label: 'Handoff', value: 'Front counter' }] },
    ],
  },
];

export const CALENDAR_PEOPLE = Object.values(people);
