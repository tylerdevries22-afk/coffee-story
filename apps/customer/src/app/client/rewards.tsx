import { TabScreenSafeArea } from '@platform/ui';
import { Redirect } from 'expo-router';
import { RewardsScreen } from '@/screens/client/rewards-screen';
import { ConstructionPaymentsScreen } from '@/screens/client/construction-project-screen';
import { TENANT_CLIENT_EXPERIENCE } from '@/tenant/client-experience';

export default function ClientRewardsRoute() {
  const experience = TENANT_CLIENT_EXPERIENCE.kind;
  if (experience === 'base') return <Redirect href="/client/home" />;
  return (
    <TabScreenSafeArea>
      {experience === 'construction' ? <ConstructionPaymentsScreen /> : <RewardsScreen />}
    </TabScreenSafeArea>
  );
}
