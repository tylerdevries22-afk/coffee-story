import type { CSSProperties } from 'react';
import {
  siApple,
  siCloudflare,
  siExpo,
  siGithub,
  siGoogle,
  siGoogleplay,
  siQuickbooks,
  siResend,
  siSentry,
  siShopify,
  siSquare,
  siStripe,
  siSupabase,
  siVercel,
  type SimpleIcon,
} from 'simple-icons';

import type { ConnectorCard } from '@/lib/integration-cards';

type ProviderLogoProps = {
  readonly card: ConnectorCard;
  readonly active?: boolean;
};

type ProviderMark = Readonly<{ path: string; viewBox: string; transform?: string }>;

const simpleMark = (icon: SimpleIcon): ProviderMark => ({ path: icon.path, viewBox: '0 0 24 24' });

const PROVIDER_MARKS: Readonly<Record<string, ProviderMark>> = {
  apple: simpleMark(siApple),
  cloudflare: simpleMark(siCloudflare),
  expo: simpleMark(siExpo),
  github: simpleMark(siGithub),
  google: simpleMark(siGoogle),
  googleplay: simpleMark(siGoogleplay),
  plaid: {
    viewBox: '0 0 512 512',
    transform: 'matrix(.1 0 0 -.1 0 512)',
    path: 'm1436 4511c-407-105-653-173-658-182-4-8-82-306-173-663l-166-650 228-228 228-228-228-228-228-228 167-655c92-360 172-659 178-665s305-86 665-178l655-167 228 228 228 228 228-228 228-228 655 167c360 92 659 172 665 178s86 305 178 665l167 655-228 228-228 228 228 228 228 228-167 655c-92 360-172 659-178 665s-305 86-665 178l-655 167-228-228-228-228-228 228c-125 125-232 227-237 226-6 0-302-76-659-168zm714-406 145-145-218-218-217-217-275 275c-151 151-273 276-271 278 6 6 650 170 671 171 13 1 70-49 165-144zm1309 65c174-45 324-84 334-88 14-6-37-61-258-282l-275-275-217 217-218 218 145 145c80 80 151 145 158 145 8 0 157-36 331-80zm-2082-1127-217-218-147 148-148 147 79 313c44 171 84 327 89 346l9 34 276-276 277-277zm2794 410 84-333-148-147-147-148-217 218-218 217 275 275c170 170 277 270 281 262 3-6 44-162 90-344zm-1391 22 215-215-218-218-217-217-217 217-218 218 215 215c118 118 217 215 220 215s102-97 220-215zm-700-700 215-215-218-218-217-217-217 217-218 218 215 215c118 118 217 215 220 215s102-97 220-215zm1400 0 215-215-218-218-217-217-217 217-218 218 215 215c118 118 217 215 220 215s102-97 220-215zm-2100-700 215-215-275-275c-170-170-277-270-281-262-3 6-44 162-90 344l-84 333 145 145c80 80 147 145 150 145s102-97 220-215zm1400 0 215-215-218-218-217-217-217 217-218 218 215 215c118 118 217 215 220 215s102-97 220-215zm1330 70 145-145-84-333c-46-182-87-338-90-344-4-8-111 92-281 262l-275 275 215 215c118 118 217 215 220 215s70-65 150-145zm-2030-770 215-215-148-148-147-147-313 79c-171 44-327 84-346 89l-34 9 274 274c151 151 276 274 279 274s102-97 220-215zm1459-59 274-274-34-9c-19-5-175-45-346-89l-313-79-147 147-148 148 215 215c118 118 217 215 220 215s128-123 279-274z',
  },
  quickbooks: simpleMark(siQuickbooks),
  resend: simpleMark(siResend),
  sendgrid: { viewBox: '0 0 24 24', path: 'M.8 24h13.6c.88 0 1.6-.72 1.6-1.6v-4.8c0-.88-.72-1.6-1.6-1.6H9.6c-.88 0-1.6-.72-1.6-1.6V9.6C8 8.72 7.28 8 6.4 8H1.6C.72 8 0 8.72 0 9.6v13.6c0 .44.36.8.8.8zM23.2 0H9.6C8.72 0 8 .72 8 1.6v4.8C8 7.28 8.72 8 9.6 8h4.8c.88 0 1.6.72 1.6 1.6v4.8c0 .88.72 1.6 1.6 1.6h4.8c.88 0 1.6-.72 1.6-1.6V.8c0-.44-.36-.8-.8-.8Z' },
  sentry: simpleMark(siSentry),
  shopify: simpleMark(siShopify),
  slack: { viewBox: '0 0 24 24', path: 'M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z' },
  square: simpleMark(siSquare),
  stripe: simpleMark(siStripe),
  supabase: simpleMark(siSupabase),
  twilio: { viewBox: '0 0 24 24', path: 'M12 0C5.381-.008.008 5.352 0 11.971V12c0 6.64 5.359 12 12 12 6.64 0 12-5.36 12-12 0-6.641-5.36-12-12-12zm0 20.801c-4.846.015-8.786-3.904-8.801-8.75V12c-.014-4.846 3.904-8.786 8.75-8.801H12c4.847-.014 8.786 3.904 8.801 8.75V12c.015 4.847-3.904 8.786-8.75 8.801H12zm5.44-11.76c0 1.359-1.12 2.479-2.481 2.479-1.366-.007-2.472-1.113-2.479-2.479 0-1.361 1.12-2.481 2.479-2.481 1.361 0 2.481 1.12 2.481 2.481zm0 5.919c0 1.36-1.12 2.48-2.481 2.48-1.367-.008-2.473-1.114-2.479-2.48 0-1.359 1.12-2.479 2.479-2.479 1.361-.001 2.481 1.12 2.481 2.479zm-5.919 0c0 1.36-1.12 2.48-2.479 2.48-1.368-.007-2.475-1.113-2.481-2.48 0-1.359 1.12-2.479 2.481-2.479 1.358-.001 2.479 1.12 2.479 2.479zm0-5.919c0 1.359-1.12 2.479-2.479 2.479-1.367-.007-2.475-1.112-2.481-2.479 0-1.361 1.12-2.481 2.481-2.481 1.358 0 2.479 1.12 2.479 2.481z' },
  vercel: simpleMark(siVercel),
};

/** Renders a locally bundled provider mark with a deterministic text fallback. */
export function ProviderLogo({ card, active = false }: ProviderLogoProps) {
  const slug = card.logo.simpleIconsSlug?.replace(/[^a-z0-9]/g, '') ?? '';
  const mark = PROVIDER_MARKS[slug];
  const style = { '--provider-color': card.logo.brandColor } as CSSProperties;
  return (
    <span className={`provider-logo${active ? ' active' : ''}`} style={style} aria-hidden="true">
      {mark ? (
        <svg className="provider-logo-icon" viewBox={mark.viewBox} role="presentation">
          <path fill="currentColor" d={mark.path} transform={mark.transform} />
        </svg>
      ) : card.displayName.slice(0, 2).toUpperCase()}
    </span>
  );
}
