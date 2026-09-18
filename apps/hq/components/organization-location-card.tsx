'use client';

import type { BusinessStepField } from '@/lib/organization-business-step';
import {
  DEFAULT_HOURS, DEFAULT_TIMEZONE, placeCoordinates, timezoneOptions, type PlacePrefill, type PrefillField,
} from '@/lib/place-prefill';

import { FieldLabel, invalidProps } from './field-label';
import { HoursEditor } from './hours-editor';

type LocationCardProps = {
  /** Remount the card (see `PlacePrefill.key`) to start over from another pick. */
  readonly prefill: PlacePrefill;
  readonly invalidField: BusinessStepField | null;
  readonly onEdited: (field: PrefillField) => void;
};

/**
 * The first location, starting from whatever a Google pick supplied.
 *
 * The inputs are uncontrolled on purpose: the form posts them as they stand,
 * and a pick replaces them wholesale by remounting, so the only state the
 * wizard tracks is which of them still hold Google's value.
 */
export function OrganizationLocationCard({ prefill, invalidField, onEdited }: LocationCardProps) {
  const { draft } = prefill;
  const google = (field: PrefillField) => prefill.fromGoogle.has(field);
  const pin = placeCoordinates(prefill);
  return (
    <section className="onboarding-card location-card">
      <header><span>02</span><div><strong>First location</strong>
        <p>Start with one location. Add more at any time.</p></div></header>
      <div className="onboarding-fields location-fields">
        <FieldLabel label="Location name" fromGoogle={google('locationName')}>
          <input name="locationName" required maxLength={120} placeholder="Main location"
            defaultValue={draft?.name ?? ''} onChange={() => onEdited('locationName')}
            {...invalidProps('locationName', invalidField)} />
        </FieldLabel>
        <FieldLabel label="Street" optional fromGoogle={google('street')}>
          <input name="street" maxLength={160} autoComplete="street-address" placeholder="100 Market Street"
            defaultValue={draft?.street ?? ''} onChange={() => onEdited('street')} />
        </FieldLabel>
        <FieldLabel label="City" fromGoogle={google('city')}>
          <input name="city" maxLength={120} autoComplete="address-level2" placeholder="Riverside"
            defaultValue={draft?.city ?? ''} onChange={() => onEdited('city')} />
        </FieldLabel>
        <FieldLabel label="State / region" optional fromGoogle={google('region')}>
          <input name="region" maxLength={80} autoComplete="address-level1" placeholder="State or region"
            defaultValue={draft?.region ?? ''} onChange={() => onEdited('region')} />
        </FieldLabel>
        <FieldLabel label="Postal code" optional fromGoogle={google('postal')}>
          <input name="postal" maxLength={24} autoComplete="postal-code" placeholder="Postal code"
            defaultValue={draft?.postal ?? ''} onChange={() => onEdited('postal')} />
        </FieldLabel>
        <FieldLabel label="Timezone" fromGoogle={google('timezone')}>
          <select name="timezone" required defaultValue={draft?.timezone ?? DEFAULT_TIMEZONE}
            onChange={() => onEdited('timezone')} {...invalidProps('timezone', invalidField)}>
            {timezoneOptions(draft?.timezone).map((zone) => <option key={zone}>{zone}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Phone" optional fromGoogle={google('phone')}>
          <input name="phone" type="tel" maxLength={32} autoComplete="tel" placeholder="+1 555 010 0100"
            defaultValue={draft?.phone ?? ''} onChange={() => onEdited('phone')}
            {...invalidProps('phone', invalidField)} />
        </FieldLabel>
      </div>
      {/* The listing this location came from, and where it sits on the map. */}
      <input type="hidden" name="googlePlaceId" value={draft?.googlePlaceId ?? ''} />
      <input type="hidden" name="lat" value={pin.lat} />
      <input type="hidden" name="lng" value={pin.lng} />
      <HoursEditor initial={draft?.hours ?? DEFAULT_HOURS} fromGoogle={google('hours')}
        invalid={invalidField === 'hours'} onEdited={() => onEdited('hours')} />
    </section>
  );
}
