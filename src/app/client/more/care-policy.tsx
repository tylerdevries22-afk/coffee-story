import { InformationPage } from '@/screens/client/more/information-page';
import { useAppState } from '@/state/app-context';

export default function ClientMoreCarePolicyRoute() {
  const { openMore } = useAppState();
  return <InformationPage page="care-policy" onBack={() => openMore('menu')} />;
}
