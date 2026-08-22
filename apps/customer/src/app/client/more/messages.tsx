import { Messages } from '@/screens/client/more/messages';
import { useAppState } from '@/state/app-context';

export default function ClientMoreMessagesRoute() {
  const { openMore } = useAppState();
  return <Messages onBack={() => openMore('menu')} />;
}
