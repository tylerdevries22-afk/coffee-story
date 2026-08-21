import { AdminDirectory } from '@/screens/client/more/admin-directory';
import { useAppState } from '@/state/app-context';

export default function ClientMoreAdminRoute() {
  const { openMore } = useAppState();
  return <AdminDirectory onBack={() => openMore('menu')} />;
}
