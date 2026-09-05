import type { PrepBoardEntry } from '@platform/data';
import { projectFirstVariants, type OrderableItem, type StaffDashboard } from '@platform/domain';

import { DEMO_TAX_JURISDICTIONS } from './business';
import { CALENDAR_ITEMS, CALENDAR_PEOPLE } from './calendar-demo';
import { MENU_ITEMS } from './catalog';
import { DEMO_SHIFTS } from './crew-demo';
import { DEMO_STAFF } from './demo';
import { initialDemoOrders } from './demo-orders';
import { usesLaunchDemoFixtures } from './demo-tenant';
import { DEMO_BAKE_LIST } from './prep-demo';
import type { CalendarItem } from '@/features/calendar/presentation';
import type { Shift } from '@/features/crew/shift';
import type { BoardOrder } from '@/features/operator/board';

type CalendarPerson = CalendarItem['assignees'][number];

export type OperatorDemoFixtures = {
  launch: boolean;
  staffDashboard: StaffDashboard;
  orderableItems: readonly OrderableItem[];
  boardOrders: readonly BoardOrder[];
  shifts: readonly Shift[];
  prepBatches: readonly PrepBoardEntry[];
  calendarItems: readonly CalendarItem[];
  calendarPeople: readonly CalendarPerson[];
  taxJurisdictions: typeof DEMO_TAX_JURISDICTIONS;
};

const EMPTY_STAFF_DASHBOARD: StaffDashboard = {
  orders: [], clients: [], projectedCents: 0, openMinutes: 0, promptForTip: false,
};

/** Rich launch fixtures never stand in for an explicitly selected tenant. */
export function demoFixturesFor(slug?: string): OperatorDemoFixtures {
  const launch = usesLaunchDemoFixtures(slug);
  if (!launch) {
    return {
      launch, staffDashboard: EMPTY_STAFF_DASHBOARD, orderableItems: [], boardOrders: [],
      shifts: [], prepBatches: [], calendarItems: [], calendarPeople: [], taxJurisdictions: [],
    };
  }
  return {
    launch, staffDashboard: DEMO_STAFF, orderableItems: projectFirstVariants(MENU_ITEMS),
    boardOrders: initialDemoOrders(), shifts: DEMO_SHIFTS, prepBatches: DEMO_BAKE_LIST,
    calendarItems: CALENDAR_ITEMS, calendarPeople: CALENDAR_PEOPLE,
    taxJurisdictions: DEMO_TAX_JURISDICTIONS,
  };
}

export const DEMO_OPERATOR_FIXTURES = demoFixturesFor(process.env.EXPO_PUBLIC_TENANT);
