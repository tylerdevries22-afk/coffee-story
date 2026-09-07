import { call, PLATFORM_CURRENCY, type PlatformCurrency, type SquareConfig } from './transport';

export type SquareOrderLine = {
  name: string;
  quantity: string;               // Square wants a string
  base_price_money: { amount: number; currency: PlatformCurrency };
  note?: string;
};

export function createSquareOrder(
  config: SquareConfig,
  token: string,
  input: { squareLocationId: string; referenceId: string; lines: SquareOrderLine[] },
): Promise<{ order?: { id?: string } }> {
  return call(config, '/v2/orders', {
    method: 'POST',
    token,
    body: {
      idempotency_key: `order-${input.referenceId}`,
      order: {
        location_id: input.squareLocationId,
        reference_id: input.referenceId,
        line_items: input.lines,
      },
    },
  });
}

/**
 * A hosted checkout page for one order: the tender that works in Expo Go and
 * in a web build, where no native card SDK exists. Square hosts the page and
 * takes the card; the payment webhook is what moves the order to paid, so
 * nothing here trusts the browser coming back.
 *
 * `app_fee_money` rides on checkout_options rather than the payment (rule 3
 * still applies -- the platform's cut is set when the link is minted).
 */
export function createPaymentLink(
  config: SquareConfig,
  token: string,
  input: {
    squareLocationId: string;
    referenceId: string;
    lines: SquareOrderLine[];
    /**
     * Tax and tip as exact amounts, not percentages Square recomputes.
     * The platform rounds tax per row per authority, and the guest must be
     * charged the total those rows add up to — a percentage handed to Square
     * can land a cent away from it, which is a cent nobody can reconcile.
     */
    taxCents: number;
    taxLabel: string;
    tipCents: number;
    appFeeCents: number;
    /** Where Square sends the guest afterwards; the app's order screen. */
    redirectUrl?: string;
    buyerEmail?: string;
    note?: string;
  },
): Promise<{ payment_link?: { id?: string; url?: string; order_id?: string } }> {
  const serviceCharges = [
    ...(input.taxCents > 0 ? [{
      name: input.taxLabel,
      amount_money: { amount: input.taxCents, currency: PLATFORM_CURRENCY },
      calculation_phase: 'TOTAL_PHASE',
      taxable: false,
    }] : []),
    ...(input.tipCents > 0 ? [{
      name: 'Tip',
      amount_money: { amount: input.tipCents, currency: PLATFORM_CURRENCY },
      calculation_phase: 'TOTAL_PHASE',
      taxable: false,
    }] : []),
  ];
  return call(config, '/v2/online-checkout/payment-links', {
    method: 'POST',
    token,
    body: {
      idempotency_key: `link-${input.referenceId}`,
      order: {
        location_id: input.squareLocationId,
        reference_id: input.referenceId,
        line_items: input.lines,
        ...(serviceCharges.length > 0 ? { service_charges: serviceCharges } : {}),
      },
      checkout_options: {
        allow_tipping: false,          // the tip is already priced into the order
        ask_for_shipping_address: false,
        ...(input.appFeeCents > 0
          ? { app_fee_money: { amount: input.appFeeCents, currency: PLATFORM_CURRENCY } }
          : {}),
        ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {}),
      },
      ...(input.buyerEmail ? { pre_populated_data: { buyer_email: input.buyerEmail } } : {}),
      ...(input.note ? { payment_note: input.note } : {}),
    },
  });
}

