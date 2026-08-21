import { InformationPage } from '@/screens/client/more/information-page';
import { useAppState } from '@/state/app-context';

export default function ClientMoreFaqRoute() {
  const { openMore } = useAppState();
  return <InformationPage page="faq" onBack={() => openMore('menu')} />;
}
