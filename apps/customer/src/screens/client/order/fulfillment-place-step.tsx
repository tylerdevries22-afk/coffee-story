import type { DeliveryAddress, FulfillmentMode, OrderFulfillment } from '@platform/domain';

import { DeliveryAddressStep } from './fulfillment-delivery-step';
import { PickupLocationStep } from './fulfillment-pickup-step';

export function PlaceStep({
  mode,
  isDemo,
  initialAddress,
  onBack,
  onChoose,
}: {
  mode: FulfillmentMode;
  isDemo: boolean;
  initialAddress?: DeliveryAddress;
  onBack: () => void;
  onChoose: (fulfillment: OrderFulfillment) => void;
}) {
  return mode === 'pickup'
    ? <PickupLocationStep onBack={onBack} onChoose={onChoose} />
    : <DeliveryAddressStep isDemo={isDemo} initialAddress={initialAddress} onBack={onBack} onChoose={onChoose} />;
}
