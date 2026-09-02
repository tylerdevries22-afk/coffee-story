/**
 * Request-level guards for placement: the stable digest a retry is matched
 * on, and the client-ceiling check that can only ever reject a price.
 */
import { createHash } from 'node:crypto';

import type { CreateOrderInput } from './types';

/**
 * Stable digest of the checkout request before menu, availability or tax data
 * is consulted. Optional fields are normalized to the behavior the engine
 * applies, so omitted and explicit empty values do not create false
 * conflicts. Tax jurisdictions are intentionally absent: they are mutable
 * server configuration, not input from the checkout attempt.
 */
export function orderRequestFingerprint(input: CreateOrderInput): string {
  const canonical = {
    version: 1,
    brandId: input.brandId,
    locationId: input.locationId,
    customerId: input.customerId,
    actorUserId: input.actorUserId,
    fulfillmentType: input.fulfillmentType,
    scheduledFor: input.scheduledFor,
    note: input.note,
    lines: input.lines.map((line) => ({
      itemSlug: line.itemSlug,
      sizeSlug: line.sizeSlug ?? null,
      quantity: line.quantity,
      modifierSlugs: line.modifierSlugs ?? [],
      note: line.note ?? '',
      packContents: (line.packContents ?? []).map((content) => ({
        itemSlug: content.itemSlug,
        quantity: content.quantity,
      })),
    })),
    tipCents: input.tipCents,
    maximumTotalCents: input.maximumTotalCents ?? null,
    tenderType: input.tenderType,
    channel: input.channel,
    guestLabel: input.guestLabel,
    deviceId: input.deviceId,
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

/** A client ceiling can only reject an increase; it never sets a price. */
export function totalExceedsApprovedMaximum(totalCents: number, maximumTotalCents?: number): boolean {
  return maximumTotalCents !== undefined && totalCents > maximumTotalCents;
}
