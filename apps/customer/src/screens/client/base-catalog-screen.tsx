import { formatMoney } from '@platform/domain';

import { Body, Card, PillRow, Screen, SectionTitle, Title } from '@/components/ui';
import { useCustomerCatalog } from '@/state/catalog-context';

/** Read-only catalog for Base App tenants without commerce-ordering. */
export function BaseCatalogScreen() {
  const { categories, items, status } = useCustomerCatalog();
  return (
    <Screen>
      <Title>Catalog</Title>
      <Body muted>Browse available services and resources. Contact the business to continue.</Body>
      {status === 'unavailable' ? (
        <Card><Body muted>The catalog is temporarily unavailable.</Body></Card>
      ) : null}
      {categories.map((category) => {
        const categoryItems = items.filter((item) => item.category === category.id);
        return (
          <Card key={category.id}>
            <SectionTitle>{category.title}</SectionTitle>
            {category.tagline ? <Body muted>{category.tagline}</Body> : null}
            {categoryItems.map((item) => {
              const lowest = item.sizes.reduce(
                (value, size) => Math.min(value, size.priceCents),
                Number.POSITIVE_INFINITY,
              );
              return (
                <PillRow
                  key={item.id}
                  title={item.name}
                  subtitle={item.description}
                  value={<Body muted>{Number.isFinite(lowest) ? formatMoney(lowest) : 'Contact us'}</Body>}
                />
              );
            })}
          </Card>
        );
      })}
    </Screen>
  );
}
