import { GiftBalance } from '@/screens/client/more/account-pages';
import { useAppState } from '@/state/app-context';

export default function ClientMoreGiftBalanceRoute() {
  const { openMore, startBooking } = useAppState();
  return <GiftBalance onBack={() => openMore('menu')} onBook={() => startBooking()} />;
}
