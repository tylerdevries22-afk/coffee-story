import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTokens } from '@platform/ui';

import { KioskChrome } from '@/components/chrome/kiosk-chrome';
import { StepStage } from '@/components/chrome/step-stage';
import { useFlow } from '@/state/flow';
import { useKioskSession } from '@/state/session';

/**
 * Everything inside the ordering flow shares one frame.
 *
 * The group `(flow)` does not appear in the URL, so `order/entry.tsx` is still
 * `/order/entry` -- the routes stay addressable, which is what lets
 * `scripts/capture-surfaces.mjs` screenshot each step by navigating to it.
 */
export default function FlowLayout() {
  const tokens = useTokens();
  const { flow, step, backTarget, goBack, startOver } = useFlow();
  const { touch, resetSeq } = useKioskSession();

  // The idle reset has to navigate as well as clear. Without this a guest whose
  // session timed out is left looking at a fill screen with an empty tray.
  useEffect(() => {
    if (resetSeq > 0) startOver();
    // startOver is stable enough for this; re-running on every identity change
    // would bounce the guest out of the flow they are in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSeq]);

  return (
    <View style={[styles.root, { backgroundColor: tokens.surface }]} onTouchStart={touch}>
      <KioskChrome
        utilities={flow.utilities}
        canGoBack={backTarget !== null}
        onBack={goBack}
        onStartOver={startOver}
        onUtility={() => undefined}
      />
      <StepStage stepKey={step}>
        <Slot />
      </StepStage>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
