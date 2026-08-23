import { GiftBalance } from '@/screens/client/more/account-pages';
import { useAppState } from '@/state/app-context';

export default function ClientMoreGiftBalanceRoute() {
  const { openMore, startOrder } = useAppState();
  return <GiftBalance onBack={() => openMore('menu')} onBook={() => startOrder()} />;
}
