import type { DeviceRole } from '@platform/schema';

/**
 * One binary, two postures.
 *
 * A lobby kiosk and a staff register run the same code on the same hardware;
 * what differs is who is standing at it. That is a property of the paired
 * device, not a build flag -- swapping a tablet between the counter and the
 * lobby should be a re-pair, not a re-release.
 */
export type KioskPosture = {
  /** Guest-facing: nothing that could expose another order. */
  unattended: boolean;
  /** The guest may choose pay-at-counter; collection stays with staff. */
  allowsCashTender: boolean;
  /** Looking an order up by ticket shows a name; staff only. */
  allowsOrderLookup: boolean;
  /** Abandoned-session reset only makes sense with nobody minding it. */
  idleResets: boolean;
  channel: 'kiosk' | 'pos';
};

export function postureFor(role: DeviceRole): KioskPosture | null {
  if (role === 'kiosk') {
    return {
      unattended: true,
      allowsCashTender: true,
      allowsOrderLookup: false,
      idleResets: true,
      channel: 'kiosk',
    };
  }
  if (role === 'pos') {
    return {
      unattended: false,
      allowsCashTender: true,
      allowsOrderLookup: true,
      // A register is attended; resetting it mid-transaction would lose a
      // queue the barista is holding in their head.
      idleResets: false,
      channel: 'pos',
    };
  }
  // A display or prep token has no business running this binary at all.
  return null;
}
