import { TabScreenSafeArea } from '@/components/navigation/tab-screen';
import { OrderScreen } from '@/screens/client/order-screen';

export default function ClientBookRoute() {
  return <TabScreenSafeArea><OrderScreen /></TabScreenSafeArea>;
}
