/**
 * The first email to a business whose demo was built, as a draft for the
 * operator to send from their own cold-email tool. Nothing here sends, and
 * nothing in HQ can: the send button stays with the operator.
 *
 * The factory only builds demos for US listings, and US commercial email runs
 * under CAN-SPAM, so every draft carries what that law asks of the message
 * itself: a subject that says what the email is, the message identified as an
 * advertisement, the sender's valid postal address, and a plain way to opt
 * out. The operator's sending tool adds the headers and its own unsubscribe
 * link, and honouring an opt-out within ten business days is the operator's.
 *
 * The text claims only what is true of the demo it links: built from the
 * public listing, and from the business's own website only when its menu
 * really came from there.
 */
export type OutreachSender = {
  readonly name: string;
  readonly postalAddress: string;
};

export type OutreachSite = {
  readonly id: string;
  readonly businessName: string;
  /** The address the business publishes for enquiries, as its website gave it. */
  readonly email: string | null;
  readonly countryCode: string | null;
  readonly state: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly menuFromWebsite: boolean;
};

export type OutreachDraft = {
  readonly siteId: string;
  readonly to: string;
  readonly businessName: string;
  readonly subject: string;
  readonly text: string;
  readonly link: string;
  readonly expiresOn: string;
};

export type OutreachSkip = 'not_ready' | 'outside_us' | 'no_email' | 'expiring';

export type OutreachDecision =
  | { readonly ok: true; readonly draft: OutreachDraft }
  | { readonly ok: false; readonly reason: OutreachSkip };

/** A link that dies within two days is not worth a first email. */
export const OUTREACH_MIN_DAYS_LEFT = 2;
const DAY_MS = 86_400_000;

// Deliberately narrower than RFC 5321: an address that needs the exotic
// parts of the grammar is more likely scraped wrong than written that way.
const EMAIL = /^[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
// Control characters, plus the two Unicode separators some clients render as a line break.
const LINE_BREAKING = /[\p{Cc}  ]+/gu;

/** One line of text, safe in a subject or a CSV cell: no control characters, no line breaks. */
export function oneLine(value: string | null | undefined, max: number): string {
  return (value ?? '').replace(LINE_BREAKING, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

export function outreachEmail(value: string | null | undefined): string | null {
  const email = (value ?? '').trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

const LONG_DATE = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function body(name: string, link: string, expiresOn: string, fromWebsite: boolean, sender: OutreachSender): string {
  const source = fromWebsite ? 'your public Google listing and your own website' : 'your public Google listing';
  const menu = fromWebsite ? 'your menu' : 'a sample menu standing in for yours';
  return [
    `Hello ${name} team,`,
    '',
    `We build ordering apps for independent businesses, and we made a working demo for ${name} from ${source}:`,
    '',
    link,
    '',
    `It shows your name, your hours and ${menu} in an app your customers could order from. The link is private, `
      + `nothing in it is live, and the demo deletes itself on ${expiresOn}.`,
    '',
    'If you would like a walkthrough, reply to this email. If not, the demo page has a link that removes your '
      + 'business for good, and replying "unsubscribe" means you will not hear from us again.',
    '',
    sender.name,
    sender.postalAddress,
    '',
    `This email is an advertisement from ${sender.name}.`,
  ].join('\n');
}

/**
 * Why a demo gets no draft, or null when it gets one: the demo is not ready,
 * the business is outside the US, its website published no usable address,
 * or the link would expire before the email could be read.
 */
export function outreachSkip(site: OutreachSite, now = new Date()): OutreachSkip | null {
  if (site.state !== 'ready') return 'not_ready';
  if (site.countryCode !== 'US') return 'outside_us';
  if (outreachEmail(site.email) === null) return 'no_email';
  const expires = Date.parse(site.expiresAt);
  return Number.isFinite(expires) && expires - now.getTime() >= OUTREACH_MIN_DAYS_LEFT * DAY_MS ? null : 'expiring';
}

export function outreachDraft(site: OutreachSite, sender: OutreachSender, link: string, now = new Date()): OutreachDecision {
  const reason = outreachSkip(site, now);
  const to = outreachEmail(site.email);
  if (reason !== null || to === null) return { ok: false, reason: reason ?? 'no_email' };
  const businessName = oneLine(site.businessName, 120) || 'your business';
  const expiresOn = LONG_DATE.format(new Date(Date.parse(site.expiresAt)));
  return {
    ok: true,
    draft: {
      siteId: site.id,
      to,
      businessName,
      subject: oneLine(`A working ordering-app demo for ${businessName}`, 150),
      text: body(businessName, link, expiresOn, site.menuFromWebsite, sender),
      link,
      expiresOn,
    },
  };
}
