import { Pressable, Text, View } from 'react-native';

import { POINTS_LABEL } from '@/features/rewards/presentation';
import { EARN_ACTIONS, earnActionState } from '@/features/rewards/earn-actions';
import { disabledState } from '@/lib/a11y-state';

import { hapticSelection } from '../haptics';
import { styles } from '../styles';

/**
 * `behavior` describes what a tap actually DOES, which is not the same question
 * as whether the server will award points for it:
 *
 * - 'claim'  — calls /api/mobile/rewards/activity, which verifies the action
 *              against a real source before awarding.
 * - 'sheet'  — opens an in-app sheet and never touches the rewards API. The
 *              points arrive later by another route (a referral is awarded by
 *              complete_reward_referral_for_purchase when the friend pays).
 * - 'link'   — leaves the app. Useful work, but nothing can verify it happened,
 *              so no points are claimed.
 * - 'inert'  — genuinely nothing to do: there is no OS integration behind it and
 *              no server signal, so it is shown as studio-confirmed.
 *
 * An earlier change collapsed this to a single `claimable` flag and made every
 * non-claimable row unpressable. That killed the ONLY entry point to the
 * referral sheet -- and therefore the only place a referral code or share link
 * is produced anywhere in the product -- plus the only in-app link to the Google
 * review page. Neither had ever called the rewards API, so neither was affected
 * by the 409 that change was meant to address.
 */
export function EarnTab({
  completed,
  onAction,
  onGoogleReview,
  isDemo,
}: {
  completed: string[];
  onAction: (key: string) => void;
  onGoogleReview: () => void;
  isDemo: boolean;
}) {
  return (
    <>
      <Text style={styles.sectionTitle}>Earn {POINTS_LABEL}</Text>
      <View style={styles.earnList}>
        {EARN_ACTIONS.map((action) => {
          const { complete, awaitingStudio, inert } = earnActionState(action, completed, isDemo);
          // Only a genuinely inert row is unpressable. 'sheet' and 'link' rows do
          // real work locally and never call the rewards API, so disabling them
          // removed functionality without fixing anything. Demo mode still awards
          // every key locally, which is why this was invisible in Expo Go.
          return (
            <Pressable
              key={action.key}
              accessibilityRole={inert ? undefined : 'button'}
              {...disabledState(inert)}
              accessibilityHint={awaitingStudio ? 'Confirmed by the studio, not from the app' : undefined}
              onPress={inert ? undefined : () => {
                hapticSelection();
                // A 'link' row leaves the app and must NOT also claim: nothing
                // can verify an off-site review, so the award would be minted on
                // the client's say-so and the alert would be raised behind the
                // browser where it is never seen.
                if (action.behavior === 'link') {
                  onGoogleReview();
                  return;
                }
                onAction(action.key);
              }}
              style={({ pressed }) => [
                styles.earnRow,
                complete && styles.earnRowComplete,
                pressed && !inert && styles.rowPressed,
              ]}
            >
              <Text style={[styles.earnLabel, complete && styles.earnLabelComplete]}>{action.label}</Text>
              <Text style={[styles.earnValue, complete && styles.earnValueComplete]}>
                {awaitingStudio ? 'Studio confirms' : `+${action.points}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.explainerCard}>
        <Text style={styles.explainerTitle}>How earning works</Text>
        <Text style={styles.explainerBody}>
          Eligible items, gift cards, dispatch fees, and gratuity earn points. Taxes, item fees, and amounts paid with rewards do not.
        </Text>
      </View>
    </>
  );
}
