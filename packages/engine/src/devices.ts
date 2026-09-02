/**
 * Pairing a screen to a shop.
 *
 * Split by concern: the signing key (signing-key), pairing codes
 * (pairing-codes), token signing and verification (tokens), the pairing
 * handshake (pairing), token refresh and revocation (lifecycle) and
 * long-lived refresh secrets (refresh-secrets). Shared types live in types;
 * shared row columns and token minting plumbing live in internal.
 *
 * Three of the five surfaces are screens nobody signs into, and
 * `docs/FIVE-SURFACES.md` calls the `devices` table the keystone that makes
 * that safe. Migration 0022 built the table and the RLS helpers that read
 * `app.jwt_device_*` — and then nothing ever minted a token those helpers could
 * read, so `app.device_is_active()` was false for every principal the platform
 * could issue and the kiosk, display and prep policies could never pass.
 *
 * This is the minter. It signs a JWT the project's own PostgREST accepts,
 * rather than creating an `auth.users` row per tablet: a device is not a person,
 * GoTrue's claim hook runs off a user record it would have to invent, and every
 * device would then show up in the user table forever.
 *
 * Two properties carry the whole security argument, and both are asserted in
 * `devices.test.ts` rather than left to review:
 *
 *   NO `sub`. `auth.uid()` reads it, so with it absent every policy pinned to
 *   `user_id = auth.uid()` — customers, loyalty accounts, stored value,
 *   referrals — matches nothing. A device cannot even insert a customer row,
 *   because `customers_insert` requires `user_id = auth.uid()`.
 *
 *   NO `app_metadata.role`. That is what `app.jwt_role()` reads and what every
 *   `is_brand_*` helper tests. 0022's comment says a device token deliberately
 *   carries no role; `verifyDeviceToken` REJECTS one that does rather than
 *   ignoring it, so a forged claim fails closed instead of being tolerated.
 */
export * from './devices/types';
export * from './devices/signing-key';
export * from './devices/pairing-codes';
export * from './devices/tokens';
export * from './devices/pairing';
export * from './devices/lifecycle';
export * from './devices/refresh-secrets';
