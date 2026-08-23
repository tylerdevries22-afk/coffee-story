import { currentBusiness } from '@/data/business';

export type InformationPageKey = 'location' | 'resources' | 'faq' | 'care-policy' | 'privacy';

export type InformationPageConfig = {
  eyebrow: string;
  title: string;
  summary: string;
  rows: readonly { title: string; detail: string }[];
  webPath?: string;
  action?: string;
};

/**
 * The More-stack information pages.
 *
 * The identity facts here -- which shop, where, what number -- come from the
 * tenant: they were spelled out as Coffee Story's Aurora address and phone, so
 * every other brand's guests read someone else's contact details on the page
 * that exists to tell them where to go.
 *
 * The editorial copy below is still Coffee Story's own words (the roaster it
 * serves, the prayer room, the tagline). That belongs in `brand.json` beside
 * the copy dictionary rather than in app source, and moving it needs a tenant
 * copy channel the staff app can read too -- it has no bundled tenant. Until
 * then a new tenant overwrites these strings by hand, which is honest work
 * rather than a silent wrong answer.
 */
export function informationPages(): Readonly<Record<InformationPageKey, InformationPageConfig>> {
  const business = currentBusiness();
  const where = [business.street, business.cityLine].filter(Boolean).join(', ');
  return {
  location: {
    eyebrow: business.tagline || 'Where to find us',
    title: 'Shop location & hours',
    summary: `${business.name} is a specialty coffee shop${business.cityLine ? ` in ${business.cityLine}` : ''}.`,
    rows: [
      { title: 'Where we are', detail: [where, business.phone].filter(Boolean).join(' · ') },
      { title: 'Opening hours', detail: 'Open daily 8am–11pm Sunday through Thursday, and 8am–12am Friday and Saturday.' },
      { title: 'Good to know', detail: 'Free parking, reliable Wi-Fi, comfortable seating, and a dedicated prayer room for guests.' },
    ],
    webPath: '/location',
    action: 'Open directions & shop details',
  },
  resources: {
    eyebrow: 'Our coffee, your story',
    title: 'Our story & brewing guides',
    summary: 'A modern coffee experience rooted in culture — and a few ways to enjoy it even more.',
    rows: [
      { title: 'Our beans', detail: 'We proudly serve Corvus Coffee, a Colorado roaster committed to thoughtful sourcing and precision roasting.' },
      { title: 'Halal-friendly menu', detail: 'From signature lattes to sandwiches and milk cakes, our menu is built around quality halal-friendly ingredients.' },
      { title: 'Late night & study', detail: 'Open late every day. Settle in, plug in, and stay a while — your story is welcome here.' },
    ],
    webPath: '/resources',
    action: 'Read the full story',
  },
  faq: {
    eyebrow: 'Answers',
    title: 'Frequently asked questions',
    summary: 'Tap a question to read the answer without leaving the app.',
    rows: [
      { title: 'What does Coffee Story serve?', detail: 'Espresso and signature lattes, Turkish coffee, matcha, boba, cold brew, plus fresh pastries, desserts and sandwiches.' },
      { title: 'Do you have non-coffee drinks?', detail: 'Yes — matcha lattes, boba (bubble tea), sparkling ades, smoothies and other cold drinks.' },
      { title: 'How do gift cards work?', detail: 'Gift cards never expire and can be claimed in the app or presented by a guest at the counter.' },
      { title: 'Can I use rewards with a gift card?', detail: 'Eligible rewards can be applied at checkout. Amounts paid with stored value do not earn additional Beans.' },
    ],
    webPath: '/faq',
    action: 'Read every FAQ',
  },
  'care-policy': {
    eyebrow: 'Good to know',
    title: 'Order & refund policy',
    summary: 'Every drink is made to order, just for you.',
    rows: [
      { title: 'Changing an order', detail: 'Pickup orders can be changed or cancelled until preparation begins — usually within a few minutes of ordering.' },
      { title: 'Something not right?', detail: 'Tell us at the counter or message us in the app and we will remake your drink, every time.' },
      { title: 'Refunds', detail: 'Approved refunds return to the original payment method within 3–5 business days.' },
    ],
    webPath: '/what-to-expect',
    action: 'Read the full policy',
  },
  privacy: {
    eyebrow: 'Your information',
    title: 'Privacy & terms',
    summary: 'Your information is used only to operate your account, orders, payments, and rewards.',
    rows: [
      { title: 'Account details', detail: 'Preferences and private messages are restricted to authorized members of the Coffee Story team.' },
      { title: 'Payments', detail: 'Card details are handled by the payment provider and are not stored directly in the app.' },
      { title: 'Account control', detail: 'You can request a copy or deletion of eligible account information by contacting the shop.' },
    ],
    webPath: '/privacy',
    action: 'Read the complete privacy notice',
  },
  };
}
