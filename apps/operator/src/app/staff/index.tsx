import { Redirect } from 'expo-router';

/** Staff's equivalent of `client/index.tsx` -- see that file. */
export default function StaffIndexRoute() {
  return <Redirect href="/staff/today" />;
}
