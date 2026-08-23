import { InformationPage } from '@/screens/client/more/information-page';
import { useAppState } from '@/state/app-context';

export default function ClientMoreOrderPolicyRoute() {
  const { openMore } = useAppState();
  return <InformationPage page="order-policy" onBack={() => openMore('menu')} />;
}
