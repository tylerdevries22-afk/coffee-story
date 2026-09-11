/**
 * The Order tab.
 *
 * It owns the whole ordering journey as one step machine: the hub, where the
 * order is going, when it is wanted, the menu, the bag, the note and
 * checkout. The steps that cover the tab bar are `PushFromRight` siblings of
 * the tab shell rather than routes, which is how the tab bar keeps its state
 * underneath them — the same arrangement the previous version of this screen
 * used for its one pushed page.
 *
 * The bag itself lives in `state/order-context.tsx`, above the tab shell, so a
 * guest can check their rewards mid-order and come back to a full bag.
 */

import { PushFromRight } from '@/components/push-from-right';

import { DetailsStep, PlaceStep } from './order/fulfillment-steps';

import { OrderHub } from './order/order-hub';
import { OrderMenuFlow } from './order/order-menu-flow';
import { useOrderController } from './order/use-order-controller';

export function OrderScreen() {
  const controller = useOrderController();
  const { isDemo, order, setClientTab, openMore, mode, step, setStep, guestName, pointsPerDollar, startWith, choosePlace, setupAtLeast } = controller;
  if (step === 'menu' && order.fulfillment && order.windowValue) {
    return <OrderMenuFlow controller={controller} />;
  }
  return (
    <>
      <OrderHub
        mode={mode}
        onStart={startWith}
        onOpenGift={() => setClientTab('gift')}
        onOpenCatering={() => openMore('messages')}
        onOpenRewards={() => setClientTab('rewards')}
        pointsPerDollar={pointsPerDollar}
      />

      <PushFromRight visible={setupAtLeast('place')} onDismiss={() => setStep('hub')}>
        {mode ? (
          <PlaceStep
            mode={mode}
            isDemo={isDemo}
            // Without this the form remounts empty every time it is reopened,
            // so editing a delivery order meant retyping the whole address --
            // an address the menu pill was displaying one tap earlier.
            initialAddress={order.fulfillment?.mode === 'delivery' ? order.fulfillment.address : undefined}
            onBack={() => setStep('hub')}
            onChoose={choosePlace}
          />
        ) : null}
      </PushFromRight>

      <PushFromRight visible={setupAtLeast('details')} onDismiss={() => setStep('place')}>
        {mode ? (
          <DetailsStep
            mode={mode}
            guestName={guestName}
            windowValue={order.windowValue}
            now={new Date()}
            onBack={() => setStep('place')}
            onChangeName={order.setGuestName}
            onChangeWindow={order.setWindowValue}
            onDone={() => setStep('menu')}
          />
        ) : null}
      </PushFromRight>
    </>
  );
}
