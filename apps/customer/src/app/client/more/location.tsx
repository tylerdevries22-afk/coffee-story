import { InformationPage } from '@/screens/client/more/information-page';
import { useAppState } from '@/state/app-context';

export default function ClientMoreLocationRoute() {
  const { openMore } = useAppState();
  return <InformationPage page="location" onBack={() => openMore('menu')} />;
}
