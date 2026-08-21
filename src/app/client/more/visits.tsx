import { Visits } from '@/screens/client/more/visits';
import { useAppState } from '@/state/app-context';

export default function ClientMoreVisitsRoute() {
  const { openMore, startBooking } = useAppState();
  return <Visits onBack={() => openMore('menu')} onBook={() => startBooking()} />;
}
