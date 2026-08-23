import { MenuPage } from '@/screens/client/more/menu-prices';
import { useAppState } from '@/state/app-context';

export default function ClientMoreMenuPricesRoute() {
  const { openMore, startOrder } = useAppState();
  return <MenuPage onBack={() => openMore('menu')} onBook={(itemId: string) => startOrder(itemId)} />;
}
