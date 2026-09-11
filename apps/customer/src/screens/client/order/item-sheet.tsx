/**
 * The item detail sheet: hero, size, the item's own option groups, and a
 * button whose price moves as the guest customises.
 *
 * The sheet owns its own footer rather than the screen's sticky bar — it is
 * presented in a `Modal`, so a bar positioned against the screen would sit
 * behind it.
 */
import { useRef } from 'react';

import { SheetModal } from '@/components/sheet-modal';
import type { MenuItem } from '@/data/catalog';
import type { OrderLine } from '@platform/domain';
import { useTokens as useBrandTokens } from '@platform/ui';

import { ItemSheetBody } from './item-sheet-body';
import { createStyles } from './item-sheet-styles';

export function ItemSheet({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem | null;
  onClose: () => void;
  onAdd: (line: OrderLine) => number;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  // `SheetModal` holds its tree through the exit precisely so the dismissal
  // can play. Gating the children on the same `item` that gates `visible`
  // defeated that: the body unmounted on the first frame, the sheet collapsed
  // to zero height, and a full-strength scrim faded alone over the menu.
  const lastItem = useRef<MenuItem | null>(null);
  if (item) lastItem.current = item;
  const shown = item ?? lastItem.current;

  return (
    <SheetModal
      visible={item !== null}
      onRequestClose={onClose}
      sheetStyle={styles.sheet}
    >
      {shown ? <ItemSheetBody key={shown.id} item={shown} onClose={onClose} onAdd={onAdd} /> : null}
    </SheetModal>
  );
}
