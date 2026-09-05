import { Body, Button, Card, Eyebrow, PillRow, Screen, SectionTitle, Title } from '@/components/ui';
import { useCustomerCatalog } from '@/state/catalog-context';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useBusiness } from '@/state/business';
import { TENANT_MODULE_KEYS } from '@/tenant';

/** Neutral home for a general tenant whose modules do not define a vertical. */
export function BaseHomeScreen() {
  const business = useBusiness();
  const { portal } = useAuth();
  const { categories, items, status } = useCustomerCatalog();
  const { openMore, setClientTab } = useAppState();
  const hasCatalog = TENANT_MODULE_KEYS.includes('commerce-catalog');
  const name = portal.profile.fullName.trim().split(/\s+/)[0];

  return (
    <Screen>
      <Eyebrow>Base App</Eyebrow>
      <Title>{business.name}</Title>
      <Body muted>
        {name ? `Welcome, ${name}. ` : ''}{business.tagline || 'Your client portal.'}
      </Body>

      {hasCatalog ? (
        <Card>
          <SectionTitle>Catalog</SectionTitle>
          <Body muted>
            {status === 'unavailable'
              ? 'The catalog is temporarily unavailable.'
              : `${items.length} offerings across ${categories.length} categories.`}
          </Body>
          <Button
            label="Browse catalog"
            disabled={status === 'unavailable'}
            onPress={() => setClientTab('book')}
          />
        </Card>
      ) : (
        <Card><Body muted>No customer modules are available yet.</Body></Card>
      )}

      <SectionTitle>Your portal</SectionTitle>
      <PillRow
        title="Profile"
        subtitle="Account details and preferences"
        symbol="person.crop.circle"
        onPress={() => openMore('profile')}
      />
      <PillRow
        title="Location and hours"
        subtitle={`${business.street}, ${business.cityLine}`}
        symbol="calendar"
        onPress={() => openMore('location')}
      />
      <PillRow
        title="Guides and resources"
        symbol="doc.text"
        onPress={() => openMore('resources')}
      />
    </Screen>
  );
}
