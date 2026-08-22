export type NativeAdminPageConfig = {
  eyebrow: string;
  title: string;
  summary: string;
  metrics: readonly { label: string; value: string }[];
  rows: readonly { title: string; subtitle: string }[];
  action: string;
};

export const NATIVE_ADMIN_PAGES: Readonly<Record<string, NativeAdminPageConfig>> = {
  '/admin/reviews': {
    eyebrow: 'Reputation', title: 'Reviews', summary: 'Respond to client feedback and track the studio experience.',
    metrics: [{ label: 'Rating', value: '4.9' }, { label: 'Reviews', value: '128' }, { label: 'Unanswered', value: '2' }],
    rows: [
      { title: 'Alex Rivera · 5 stars', subtitle: '“Best pistachio latte in Aurora, and the prayer room is a blessing.”' },
      { title: 'Jamie Lee · 5 stars', subtitle: '“Open late, great Wi-Fi, and the Adeni chai is the real thing.”' },
    ],
    action: 'Draft reply',
  },
  '/admin/reports': {
    eyebrow: 'Business health', title: 'Reports', summary: 'Review sales, menu mix, gratuity, refunds, and upcoming payouts.',
    metrics: [{ label: 'Net sales', value: '$8,742' }, { label: 'Payout', value: '$2,184' }, { label: 'Rebook', value: '71%' }],
    rows: [
      { title: 'Signature lattes', subtitle: '$3,960 this month' },
      { title: 'Boba & matcha', subtitle: '$2,625 this month' },
      { title: 'Gift cards', subtitle: '$1,140 this month' },
    ],
    action: 'Export report',
  },
  '/admin/talent-acquisition': {
    eyebrow: 'People', title: 'Talent acquisition', summary: 'Review barista applicants and keep each interview step visible.',
    metrics: [{ label: 'Applicants', value: '12' }, { label: 'Interviews', value: '4' }, { label: 'Offers', value: '1' }],
    rows: [
      { title: 'Mara Bennett', subtitle: 'Head barista · Interview scheduled' },
      { title: 'Devon Brooks', subtitle: 'Barista · Latte art trial' },
      { title: 'Nina Alvarez', subtitle: 'Barista trainee · New application' },
    ],
    action: 'Export candidates',
  },
  '/admin/staff': {
    eyebrow: 'People', title: 'Staff', summary: 'Control team access, shifts, stations, and permissions.',
    metrics: [{ label: 'Active', value: '3' }, { label: 'Invited', value: '1' }, { label: 'Coverage', value: '86%' }],
    rows: [
      { title: 'Pharin Jenkins', subtitle: 'Owner · Full access' },
      { title: 'Mara Bennett', subtitle: 'Head barista · Shifts and guests' },
    ],
    action: 'Invite staff',
  },
  '/admin/marketing': {
    eyebrow: 'Growth', title: 'Marketing', summary: 'Create campaigns, promotions, gift-card offers, and automated reminders.',
    metrics: [{ label: 'Subscribers', value: '684' }, { label: 'Open rate', value: '48%' }, { label: 'Bookings', value: '23' }],
    rows: [
      { title: 'Late-night hours reminder', subtitle: 'Scheduled · 412 recipients' },
      { title: 'Birthday drink', subtitle: 'Automated · Active' },
      { title: 'First-order follow-up', subtitle: 'Automated · Active' },
    ],
    action: 'New campaign',
  },
  '/admin/analytics': {
    eyebrow: 'Website', title: 'Google Analytics', summary: 'Track traffic sources, booking conversions, and the pages clients use.',
    metrics: [{ label: 'Visitors', value: '1,842' }, { label: 'Bookings', value: '96' }, { label: 'Conversion', value: '5.2%' }],
    rows: [
      { title: 'Google organic', subtitle: '44% of sessions' },
      { title: 'Direct', subtitle: '31% of sessions' },
      { title: 'Instagram', subtitle: '14% of sessions' },
    ],
    action: 'Change date range',
  },
  '/admin/ads': {
    eyebrow: 'Acquisition', title: 'Google Ads', summary: 'Monitor spend, search terms, bookings, and campaign recommendations.',
    metrics: [{ label: 'Spend', value: '$612' }, { label: 'Bookings', value: '18' }, { label: 'Cost / booking', value: '$34' }],
    rows: [
      { title: 'Coffee shop near Aurora', subtitle: 'Active · $28/day' },
      { title: 'Late night coffee Denver', subtitle: 'Active · $18/day' },
    ],
    action: 'New campaign',
  },
  '/admin/settings': {
    eyebrow: 'Configuration', title: 'Settings', summary: 'Manage availability, booking rules, payments, forms, and security.',
    metrics: [{ label: 'Profile', value: '100%' }, { label: 'Forms', value: '3' }, { label: 'Integrations', value: '4' }],
    rows: [
      { title: 'Online booking', subtitle: 'Enabled · 2-hour lead time' },
      { title: 'Payments', subtitle: 'Stripe connected · Deposits enabled' },
      { title: 'Intake forms', subtitle: '3 active documents' },
    ],
    action: 'Save changes',
  },
};
