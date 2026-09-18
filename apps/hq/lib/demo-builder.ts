/**
 * Who built a demo, as every demo page must say.
 *
 * A demo shows a real business's name, menu and hours on a page that business
 * did not ask for. That is defensible as a pitch only while the page says,
 * plainly and on every view, that it is unofficial and who made it. So the
 * builder's name is required configuration, and a deployment without it
 * refuses to render demos at all rather than showing one with the line blank
 * or guessed.
 */
export type DemoBuilder = {
  readonly name: string;
  /** Where "talk to us" points: a mailto: or https: link, or nothing. */
  readonly contactHref: string | null;
};

const NAME_MAX = 80;

function contactHref(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  // Deliberately plain: a URL with credentials in it must not pass as an address.
  if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(value)) return `mailto:${value}`;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function demoBuilder(
  env: { readonly DEMO_BUILDER_NAME?: string; readonly DEMO_BUILDER_CONTACT?: string } = process.env,
): DemoBuilder | null {
  const name = env.DEMO_BUILDER_NAME?.trim().replace(/\s+/g, ' ');
  // Angle brackets and control characters have no place in a company name and
  // would only ever arrive by mistake; refusing them keeps the banner honest.
  if (!name || name.length > NAME_MAX || /[<>\p{Cc}]/u.test(name)) return null;
  return { name, contactHref: contactHref(env.DEMO_BUILDER_CONTACT) };
}
