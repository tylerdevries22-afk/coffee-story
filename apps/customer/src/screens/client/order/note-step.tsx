import { Text, TextInput, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { ActionButton, StickyActionBar, useStickyBarClearance } from '@/components/order/order-chrome';
import { Body } from '@/components/ui';
import { MAX_ORDER_NOTE_LENGTH } from '@platform/domain';
import { useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './bag-step-styles';

export function NoteStep({
  note,
  onBack,
  onChangeNote,
  onDone,
}: {
  note: string;
  onBack: () => void;
  onChangeNote: (note: string) => void;
  onDone: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const clearance = useStickyBarClearance();
  const remaining = MAX_ORDER_NOTE_LENGTH - note.length;
  return (
    <>
      <CollapsingScreen
        title="Add a Note"
        onBack={onBack}
        backLabel="Bag"
        keyboardShouldPersistTaps="handled"
        style={styles.page}
        headerBackgroundColor={tokens.surface}
        headerBorderColor={tokens.surface}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      >
        <Body muted>
          Ordering for someone special, or something the bar should know? Add a note and it goes on
          the cup.
        </Body>
        <View style={styles.noteField}>
          <View style={styles.noteHeader}>
            <Text style={styles.fieldLabel}>Note</Text>
            <Text style={styles.noteCount}>{remaining}</Text>
          </View>
          <TextInput
            accessibilityLabel="Order note"
            value={note}
            onChangeText={onChangeNote}
            placeholder="Optional"
            placeholderTextColor={tokens.textMuted}
            maxLength={MAX_ORDER_NOTE_LENGTH}
            multiline
            style={styles.noteInput}
          />
        </View>
      </CollapsingScreen>
      <StickyActionBar>
        <ActionButton label={note.trim() ? 'Save note' : 'Skip'} onPress={onDone} />
      </StickyActionBar>
    </>
  );
}
