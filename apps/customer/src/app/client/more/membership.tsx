import { Membership } from '@/screens/client/more/account-pages';
import { useAppState } from '@/state/app-context';

export default function ClientMoreMembershipRoute() {
  const { openMore } = useAppState();
  return <Membership onBack={() => openMore('menu')} />;
}
