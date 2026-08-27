/**
 * Compatibility export for kiosk screens and tests. The geometry is shared
 * with HQ through @platform/domain so a preview cannot drift from a device.
 */
export {
  CIRCLE_SIZE,
  layoutConstellation,
  overlaps,
  type Canvas,
  type ConstellationItem,
  type PlacedCircle,
} from '@platform/domain';
