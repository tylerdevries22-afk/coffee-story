import { MenuPage } from '@/screens/client/more/services';
import { useAppState } from '@/state/app-context';

export default function ClientMoreMenuRoute() {
  const { openMore, startOrder } = useAppState();
  return <MenuPage onBack={() => openMore('menu')} onBook={(itemId) => startOrder(itemId)} />;
}
