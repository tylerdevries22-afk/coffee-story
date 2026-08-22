import { CateringRequest } from '@/screens/client/more/platform-pages';
import { useAppState } from '@/state/app-context';

export default function ClientMoreCateringRequestRoute() {
  const { openMore } = useAppState();
  return <CateringRequest onBack={() => openMore('menu')} />;
}
