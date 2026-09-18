/**
 * Packs carry no product cut-outs (see lib/demo-pack-export.ts's DemoPackMedia
 * shape -- only a logo and per-item photos). apps/customer/src/data/
 * product-cutout.tsx already treats a missing slug as "no cut-out for this
 * item" rather than an error, so the gift/rewards shelf just renders one row
 * shorter in a demo.
 */
export const BUNDLED_CUTOUTS: Readonly<Record<string, { readonly uri: string }>> = {};
