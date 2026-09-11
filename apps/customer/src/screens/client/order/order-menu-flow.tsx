
import { PushFromRight } from '@/components/push-from-right';
import {
  pointsForRedemption
} from '@/features/order/payment-split';
import { POINTS_LABEL } from '@/features/rewards/presentation';

import { BagStep, NoteStep } from './bag-step';
import { CheckoutStep } from './checkout-step';
import { ItemSheet } from './item-sheet';
import { MenuStep } from './menu-step';

import { OrderPlaced } from './order-placed';
import type { OrderController } from './use-order-controller';
export function OrderMenuFlow({ controller }: { controller: OrderController; }) {
  const { isDemo, demo, order, selectedServiceId, openMore, setMode, setStep, setOverlay, detailItem, setDetailItem, paying, payError, redeemCents, setRedeemCents, useGiftBalance, setUseGiftBalance, placed, simulated, guestName, totals, redeemableCents, giftBalanceCents, split, pointsPerDollar, pointsEarned, payment, editOrder, placeOrder, overlayAtLeast } = controller;
  if (!order.fulfillment || !order.windowValue) return null;
  return (
    <>
      <MenuStep
        fulfillment={order.fulfillment}
        windowValue={order.windowValue}
        itemCount={order.itemCount}
        subtotalCents={order.subtotalCents}
        highlightItemId={selectedServiceId}
        onBack={editOrder}
        onEdit={() => {
          setMode(order.fulfillment?.mode ?? null);
          setStep('details');
        }}
        onSelectItem={setDetailItem}
        onOpenBag={() => setOverlay('bag')}
      />

      <ItemSheet
        item={detailItem}
        onClose={() => setDetailItem(null)}
        onAdd={(line) => {
          const added = order.addLine(line);
          // The sheet stays open and explains itself when the bag could not
          // take everything the button quoted.
          if (added === line.quantity) setDetailItem(null);
          return added;
        }}
      />

      <PushFromRight visible={overlayAtLeast('bag')} onDismiss={() => setOverlay('none')}>
        <BagStep
          cart={order.cart}
          fulfillment={order.fulfillment}
          windowValue={order.windowValue}
          subtotalCents={order.subtotalCents}
          pointsPerDollar={pointsPerDollar}
          onBack={() => setOverlay('none')}
          onEdit={editOrder}
          onChangeQuantity={order.changeQuantity}
          onCheckout={() => setOverlay('note')}
        />
      </PushFromRight>

      <PushFromRight visible={overlayAtLeast('note')} onDismiss={() => setOverlay('bag')}>
        <NoteStep
          note={order.cart.note}
          onBack={() => setOverlay('bag')}
          onChangeNote={order.setNote}
          onDone={() => setOverlay('checkout')}
        />
      </PushFromRight>

      <PushFromRight
        visible={overlayAtLeast('checkout')}
        dismissDisabled={paying}
        onDismiss={() => { if (!paying) setOverlay('note'); }}
      >
        <CheckoutStep
          totals={totals}
          pointsEarned={pointsEarned}
          payment={payment}
          paymentLoading={demo.isHydrating}
          paying={paying}
          simulated={simulated}
          error={payError}
          // Point redemption applies at checkout in Demo only; live points
          // buy catalog rewards on the Rewards tab until the order API
          // carries a points-to-cents rule.
          redeem={isDemo && (redeemableCents > 0 || redeemCents > 0) ? {
            availableCents: redeemableCents,
            appliedCents: redeemCents,
            pointsCharged: pointsForRedemption(redeemCents),
            pointsName: POINTS_LABEL,
            onToggle: () => { if (!paying) setRedeemCents((current) => (current > 0 ? 0 : redeemableCents)); },
          } : null}
          storedValue={giftBalanceCents > 0 ? {
            balanceCents: giftBalanceCents,
            appliedCents: split.storedValueAppliedCents,
            enabled: useGiftBalance,
            onToggle: () => { if (!paying) setUseGiftBalance((current) => !current); },
          } : null}
          cardChargeCents={split.cardChargeCents}
          onBack={() => { if (!paying) setOverlay('note'); }}
          onTipChange={(cents) => { if (!paying) order.setTipCents(cents); }}
          onPlaceOrder={placeOrder}
          onManagePayment={() => { if (!paying) openMore('payments'); }}
        />
      </PushFromRight>

      <PushFromRight visible={overlayAtLeast('placed')} onDismiss={editOrder}>
        <OrderPlaced
          summary={placed?.summary ?? ''}
          guestName={guestName}
          windowValue={order.windowValue}
          totalCents={placed?.totalCents ?? 0}
          pointsEarned={placed?.points ?? 0}
          orderId={placed?.orderId ?? null}
          demoSynced={placed?.demoSynced === true}
          demoSyncSessionId={placed?.demoSyncSessionId ?? null}
          initialStatus={placed?.status ?? 'paid'}
          isDelivery={order.fulfillment.mode === 'delivery'}
          onViewVisits={() => {
            editOrder();
            openMore('orders');
          }}
          onDone={editOrder}
        />
      </PushFromRight>
    </>
  );
}
