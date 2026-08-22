import { Payments } from '@/screens/client/more/account-pages';
import { useAppState } from '@/state/app-context';

export default function ClientMorePaymentsRoute() {
  const { openMore } = useAppState();
  return <Payments onBack={() => openMore('menu')} />;
}
