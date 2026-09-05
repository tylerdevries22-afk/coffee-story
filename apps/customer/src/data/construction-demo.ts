import type { PortalMessage } from '@platform/domain';

export const CONSTRUCTION_ORDER_SEEDS = [
  {
    id: 'project-active',
    item: 'Kitchen Renovation · Preconstruction',
    days: 0,
    hour: 8,
    priceCents: 150000,
    status: 'in_progress',
  },
  {
    id: 'project-consult',
    item: 'Project Consultation',
    days: 2,
    hour: 10,
    priceCents: 25000,
    status: 'paid',
    mobile: true,
  },
  {
    id: 'project-warranty',
    item: 'Warranty Service Visit',
    days: 8,
    hour: 9,
    priceCents: 0,
    status: 'created',
    mobile: true,
  },
  {
    id: 'project-complete',
    item: 'Bathroom Renovation · Final Handoff',
    days: -45,
    hour: 15,
    priceCents: 750000,
    status: 'picked_up',
  },
] as const;

export const CONSTRUCTION_CHANGE_REQUESTS = [
  {
    id: 'CR-014',
    title: 'Cabinet finish update',
    status: 'Under review',
    detail: 'Scope, schedule, and price impact are visible in this preview. Approval is not connected.',
  },
] as const;

export const CONSTRUCTION_PROGRESS_DRAWS = [
  {
    id: 'preconstruction-deposit',
    title: 'Preconstruction deposit',
    status: 'Received',
    detail: 'Bound to the $1,500 preconstruction project record in the demo portal.',
  },
  {
    id: 'progress-draw-1',
    title: 'Progress draw 1',
    status: 'Not issued',
    detail: 'Scheduled after the framing inspection; no payment action is connected.',
  },
] as const;

export const CONSTRUCTION_DOCUMENTS = [
  { id: 'scope-summary', title: 'Project scope summary', status: 'Available' },
  { id: 'selection-schedule', title: 'Selection schedule', status: 'Current' },
  { id: 'payment-schedule', title: 'Payment schedule', status: 'Draft' },
] as const;

export function constructionMessages(isoAt: (days: number, hour: number) => string): PortalMessage[] {
  return [
    {
      id: 'project-message-1',
      sender: 'studio',
      body: 'Welcome, Alex. Your project team will keep scope, selections, and schedule updates here.',
      sentAt: isoAt(-12, 9),
      read: true,
    },
    {
      id: 'project-message-2',
      sender: 'client',
      body: 'The cabinet selections are approved. Please move them into procurement.',
      sentAt: isoAt(-4, 14),
      read: true,
    },
    {
      id: 'project-message-3',
      sender: 'studio',
      body: 'Cabinets are released. Your next milestone is the site readiness walkthrough Tuesday at 10:00 AM.',
      sentAt: isoAt(-3, 8),
      read: false,
    },
  ];
}
