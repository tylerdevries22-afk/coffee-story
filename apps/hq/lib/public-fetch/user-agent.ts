/**
 * How the demo builder introduces itself to a site it reads.
 *
 * A site owner looking at their access log should be able to tell what this
 * was and why it came, and robots.txt should be able to address it by name,
 * so the product token is stable and the comment says what it does. The
 * `compatible` form is the convention crawlers use so that servers treat the
 * request as an ordinary page view rather than an unknown client.
 */
export const DEMO_BUILDER_PRODUCT_TOKEN = 'OrderingDemoBuilder';

export const PUBLIC_FETCH_USER_AGENT = `Mozilla/5.0 (compatible; ${DEMO_BUILDER_PRODUCT_TOKEN}/1.0;`
  + ' reads a business\'s public site once to draft a preview of an ordering app)';
