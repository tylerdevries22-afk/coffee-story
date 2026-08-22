import { ServicesPage } from '@/screens/client/more/services';
import { useAppState } from '@/state/app-context';

export default function ClientMoreServicesRoute() {
  const { openMore, startBooking } = useAppState();
  return <ServicesPage onBack={() => openMore('menu')} onBook={(serviceId) => startBooking(serviceId)} />;
}
