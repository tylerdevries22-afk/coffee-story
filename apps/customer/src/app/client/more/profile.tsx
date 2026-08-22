import { Profile } from '@/screens/client/more/profile-and-intake';
import { useAppState } from '@/state/app-context';

export default function ClientMoreProfileRoute() {
  const { openMore } = useAppState();
  return <Profile onBack={() => openMore('menu')} />;
}
