/**
 * A demo's link, derived rather than stored.
 *
 * The database keeps only the SHA-256 of a link's token, so a leaked dump or
 * an over-broad query cannot open a demo. A runner that minted random tokens
 * would then have nowhere to keep the link it has to hand to the operator,
 * short of storing it and undoing that. So the token is an HMAC of the site's
 * id under DEMO_LINK_SECRET: the server can produce any demo's link on
 * demand, and the database alone can produce none.
 *
 * Rotating the secret retires every outstanding link at once, which is the
 * right lever if one leaks, and costs little when demos expire in two weeks.
 */
import { createHmac } from 'node:crypto';

import { demoTokenHash } from '../demo-token';

/** 32 characters is the least that could carry 256 bits of randomness as base64. */
const SECRET_MIN = 32;

export function demoLinkSecret(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const secret = env.DEMO_LINK_SECRET?.trim();
  return secret && secret.length >= SECRET_MIN ? secret : null;
}

/** 43 base64url characters: the shape `isDemoToken` admits. */
export function demoLinkToken(secret: string, siteId: string): string {
  return createHmac('sha256', secret).update(`platform-demo-link:v1:${siteId}`, 'utf8').digest('base64url');
}

export function demoLinkHash(secret: string, siteId: string): string {
  return demoTokenHash(demoLinkToken(secret, siteId));
}

/** The path a prospect is sent, relative to the HQ origin. */
export function demoLinkPath(secret: string, siteId: string): string {
  return `/d/${demoLinkToken(secret, siteId)}`;
}
