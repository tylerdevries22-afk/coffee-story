import { Intake } from '@/screens/client/more/profile-and-intake';
import { useAppState } from '@/state/app-context';

export default function ClientMoreIntakeRoute() {
  const { openMore } = useAppState();
  return <Intake onBack={() => openMore('menu')} />;
}
