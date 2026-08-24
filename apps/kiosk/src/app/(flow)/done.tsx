import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCopy, useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { resetExperience as runExperienceReset } from '@/features/experience-reset';
import * as haptics from '@/lib/haptics';
import { useBuilder } from '@/state/builder';
import { useFlow } from '@/state/flow';
import { useGuest } from '@/state/guest';
import { useKioskSession } from '@/state/session';

/** Long enough to read while walking away, short enough to free the kiosk. */
const HANDOFF_MS = 45_000;

/**
 * The handoff.
 *
 * A guest who has paid is already leaving, so this returns to attract on its
 * own -- a kiosk waiting to be dismissed is out of service until someone
 * notices. The window is generous because the optional survey is here, and a
 * screen that clears itself mid-question is worse than no question.
 */
export default function DoneStep() {
  const tokens = useTokens();
  const copy = useCopy();
  const { flow, startOver } = useFlow();
  const { guestLabel, surveyAnswers, toggleSurveyAnswer, clear: clearGuest } = useGuest();
  const builder = useBuilder();
  const { reset } = useKioskSession();

  function resetExperience() {
    runExperienceReset({
      resetSession: reset,
      clearGuest,
      resetBuilder: builder.reset,
      navigate: startOver,
    });
  }

  useEffect(() => {
    const timer = setTimeout(resetExperience, HANDOFF_MS);
    return () => clearTimeout(timer);
    // Deliberately mount-only: re-arming on every survey tap would mean a guest
    // answering questions could hold the kiosk indefinitely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.left}>
        <Text style={[styles.thanks, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.hero }]}>
          {guestLabel ? `Thank you, ${guestLabel}` : copy('orderPlaced')}
        </Text>
        <Text style={[styles.detail, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xl }]}>
          {guestLabel ? copy('handoffPromise') : 'Watch the pickup board for your order.'}
        </Text>
        <KioskPressable label="Start a new order" onPress={resetExperience} />
      </View>

      {flow.survey.enabled ? (
        <View style={styles.right}>
          <Text style={[styles.question, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.xxl }]}>
            {flow.survey.prompt}
          </Text>
          <ScrollView contentContainerStyle={styles.groups}>
            {flow.survey.groups.map((group) => (
              <View key={group.id} style={styles.group}>
                <Text style={[styles.groupName, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>
                  {group.label}
                </Text>
                {group.options.map((option) => {
                  const chosen = surveyAnswers.includes(option.id);
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: chosen }}
                      aria-pressed={chosen}
                      onPress={() => { haptics.tapped(); toggleSurveyAnswer(option.id); }}
                      style={[styles.chip, {
                        borderRadius: tokens.radius.pill,
                        borderColor: chosen ? tokens.primary : tokens.textMuted,
                        backgroundColor: chosen ? tokens.primary : tokens.surfaceElevated,
                      }]}
                    >
                      <Text style={{
                        color: chosen ? tokens.surfaceElevated : tokens.textPrimary,
                        fontFamily: tokens.fontBody, fontSize: tokens.type.lg, fontWeight: '600',
                      }}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', paddingHorizontal: 48, gap: 56 },
  left: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  right: { flex: 1, paddingTop: 8, gap: 14 },
  thanks: { textAlign: 'center' },
  detail: { textAlign: 'center' },
  question: {},
  groups: { gap: 18, paddingBottom: 32 },
  group: { gap: 10 },
  groupName: { letterSpacing: 1.1, textTransform: 'uppercase' },
  chip: { minHeight: 64, paddingHorizontal: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
