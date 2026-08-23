import { Redirect } from 'expo-router';

/**
 * Staff's equivalent of `client/index.tsx` -- see that file.
 *
 * Lands on the board rather than a roster: a mounted device waking up should
 * show the work, and the shift's own details are one tap away.
 */
export default function StaffIndexRoute() {
  return <Redirect href="/staff/orders" />;
}
