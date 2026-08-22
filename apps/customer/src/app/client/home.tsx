import { TabScreenSafeArea } from '@/components/navigation/tab-screen';
import { HomeScreen } from '@/screens/client/home-screen';

export default function ClientHomeRoute() {
  return <TabScreenSafeArea><HomeScreen /></TabScreenSafeArea>;
}
