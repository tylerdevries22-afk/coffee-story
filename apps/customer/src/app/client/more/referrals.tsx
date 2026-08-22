import { Referrals } from '@/screens/client/more/platform-pages';
import { useAppState } from '@/state/app-context';

export default function ClientMoreReferralsRoute() {
  const { openMore } = useAppState();
  return <Referrals onBack={() => openMore('menu')} />;
}
