import { Orders } from '@/screens/client/more/orders';
import { useAppState } from '@/state/app-context';

export default function ClientMoreVisitsRoute() {
  const { openMore, startOrder } = useAppState();
  return <Orders onBack={() => openMore('menu')} onBook={() => startOrder()} />;
}
