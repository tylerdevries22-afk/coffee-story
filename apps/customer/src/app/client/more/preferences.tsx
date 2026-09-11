import { Preferences } from '@/screens/client/more/preferences-screen';
import { useAppState } from '@/state/app-context';

export default function ClientMorePreferencesRoute() {
  const { openMore } = useAppState();
  return <Preferences onBack={() => openMore('menu')} />;
}
