import { CollapsingScreen } from '@/components/collapsing-screen';
import { PillRow, SectionTitle } from '@/components/ui';
import { adminDestinationsForRole } from '@/data/portal-navigation';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';

export function AdminDirectory({ onBack }: { onBack: () => void }) {
  const { enterStaff, openStaffDestination } = useAppState();
  const { role } = useAuth();
  const nativeEntry = (path: string) => {
    openStaffDestination(path);
    enterStaff();
  };
  return (
    <CollapsingScreen title="Admin & staff" eyebrow="Role-aware operations" onBack={onBack}>
      <SectionTitle>Native workspace</SectionTitle>
      <PillRow title="Dashboard / Today" symbol="calendar" onPress={() => nativeEntry('/admin/dashboard')} />
      <PillRow title="Calendar" symbol="calendar" onPress={() => nativeEntry('/admin/calendar')} />
      <PillRow title="Guests" symbol="person.crop.circle" onPress={() => nativeEntry('/admin/clients')} />
      <PillRow title="Point of sale" symbol="creditcard" onPress={() => nativeEntry('/admin/pos')} />
      <SectionTitle>All administration pages</SectionTitle>
      {adminDestinationsForRole(role).map((destination) => (
        <PillRow key={destination.path} title={destination.title} subtitle="Open native page" onPress={() => nativeEntry(destination.path)} />
      ))}
    </CollapsingScreen>
  );
}
