import { DropsArchive } from '@/screens/client/more/platform-pages';
import { useAppState } from '@/state/app-context';

export default function ClientMoreDropsArchiveRoute() {
  const { openMore } = useAppState();
  return <DropsArchive onBack={() => openMore('menu')} />;
}
