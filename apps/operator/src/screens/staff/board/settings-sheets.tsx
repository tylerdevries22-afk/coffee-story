import {
  Pressable,
  Text
} from 'react-native';

import { useOperator } from '@/state/operator-store';
import { choiceState, useTokens as useBrandTokens } from '@platform/ui';

import { SettingToggle, SheetShell } from './board-controls';
import { createStyles } from './board-styles';
export function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void; }) {
  const operator = useOperator();
  return (
    <SheetShell visible={visible} title="Board settings" onClose={onClose}>
      <SettingToggle
        label="New-order alert"
        detail="Haptic and badge when an order lands"
        value={operator.settings.newOrderAlert}
        onToggle={() => operator.updateSettings({ newOrderAlert: !operator.settings.newOrderAlert })}
      />
      <SettingToggle
        label="KDS display mode"
        detail="Bigger type, no prices — for a mounted kitchen screen"
        value={operator.settings.kdsMode}
        onToggle={() => operator.updateSettings({ kdsMode: !operator.settings.kdsMode })}
      />
      <SettingToggle
        label="Ticket printer"
        detail="Print locally when an order starts (iOS AirPrint)"
        value={operator.settings.printerEnabled}
        onToggle={() => operator.updateSettings({ printerEnabled: !operator.settings.printerEnabled })}
      />
    </SheetShell>
  );
}

export function LocationSheet({ visible, onClose }: { visible: boolean; onClose: () => void; }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const operator = useOperator();
  return (
    <SheetShell visible={visible} title="Working location" onClose={onClose}>
      {operator.locations.map((location) => (
        <Pressable
          key={location.id}
          accessibilityRole="radio"
          {...choiceState(operator.location.id === location.id)}
          onPress={() => { operator.setLocation(location); onClose(); }}
          style={({ pressed }) => [styles.locationRow, pressed && styles.pressed]}
        >
          <Text style={styles.locationName}>{location.name}</Text>
          {operator.location.id === location.id ? <Text style={styles.locationCurrent}>Current</Text> : null}
        </Pressable>
      ))}
    </SheetShell>
  );
}
