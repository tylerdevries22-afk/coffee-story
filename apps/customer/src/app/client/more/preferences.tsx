import { Preferences } from '@/screens/client/more/profile-and-preferences';
import { useAppState } from '@/state/app-context';

export default function ClientMoreIntakeRoute() {
  const { openMore } = useAppState();
  return <Preferences onBack={() => openMore('menu')} />;
}
