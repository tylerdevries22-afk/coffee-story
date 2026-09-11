import { call, PLATFORM_CURRENCY, type PlatformCurrency, type SquareConfig } from './transport';

export type SquareOrderLine = {
  name: string;
  quantity: string;               // Square wants a string
  base_price_money: { amount: number; currency: PlatformCurrency };
  note?: string;
};

export type SquareOrderSnapshot = {
  id?: string;
  location_id?: string;
  reference_id?: string;
  state?: string;
  version?: number;
  tenders?: unknown[];
  total_money?: { amount?: number; currency?: string };
};

export type SquarePaymentLinkResponse = {
  payment_link?: { id?: string; url?: string; order_id?: string };
  related_resources?: { orders?: SquareOrderSnapshot[] };
};

export function createSquareOrder(
  config: SquareConfig,
  token: string,
  input: {
    squareLocationId: string;
    referenceId: string;
    lines: SquareOrderLine[];
    taxCents: number;
    taxLabel: string;
    storedValueCents: number;
  },
): Promise<{ order?: SquareOrderSnapshot }> {
  const serviceCharges = input.taxCents > 0 ? [{
    name: input.taxLabel,
    amount_money: { amount: input.taxCents, currency: PLATFORM_CURRENCY },
    calculation_phase: 'TOTAL_PHASE',
    taxable: false,
  }] : [];
  const discounts = input.storedValueCents > 0 ? [{
    uid: 'stored-value',
    name: 'Stored value',
    type: 'FIXED_AMOUNT',
    amount_money: { amount: input.storedValueCents, currency: PLATFORM_CURRENCY },
    scope: 'ORDER',
  }] : [];
  return call(config, '/v2/orders', {
    method: 'POST',
    token,
    body: {
      idempotency_key: `order-${input.referenceId}`,
      order: {
        location_id: input.squareLocationId,
        reference_id: input.referenceId,
        line_items: input.lines,
        ...(serviceCharges.length > 0 ? { service_charges: serviceCharges } : {}),
        ...(discounts.length > 0 ? { discounts } : {}),
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
    storedValueCents: number;
    appFeeCents: number;
    /** Where Square sends the guest afterwards; the app's order screen. */
    redirectUrl?: string;
    buyerEmail?: string;
    note?: string;
  },
): Promise<SquarePaymentLinkResponse> {
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
  const discounts = input.storedValueCents > 0 ? [{
    uid: 'stored-value', name: 'Stored value', type: 'FIXED_AMOUNT', scope: 'ORDER',
    amount_money: { amount: input.storedValueCents, currency: PLATFORM_CURRENCY },
  }] : [];
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
        ...(discounts.length > 0 ? { discounts } : {}),
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

/** Disable a hosted checkout page before its fee reservation is released. */
export async function deletePaymentLink(
  config: SquareConfig,
  token: string,
  paymentLinkId: string,
): Promise<{ id?: string; cancelled_order_id?: string }> {
  if (!paymentLinkId.trim()) throw new RangeError('Square payment link id is required.');
  return call(config, `/v2/online-checkout/payment-links/${encodeURIComponent(paymentLinkId)}`, {
    method: 'DELETE',
    token,
  });
}

/** Read provider state when a deletion response was lost and a retry returns 404. */
export function retrieveSquareOrder(
  config: SquareConfig,
  token: string,
  squareOrderId: string,
): Promise<{ order?: SquareOrderSnapshot }> {
  if (!squareOrderId.trim()) throw new RangeError('Square order id is required.');
  return call(config, `/v2/orders/${encodeURIComponent(squareOrderId)}`, {
    method: 'GET',
    token,
  });
}

/** Close an exact unpaid order under Square's optimistic version fence. */
export function cancelSquareOrder(
  config: SquareConfig,
  token: string,
  input: {
    squareOrderId: string;
    squareLocationId: string;
    version: number;
    referenceId: string;
  },
): Promise<{ order?: SquareOrderSnapshot }> {
  if (!input.squareOrderId.trim() || !input.squareLocationId.trim()
    || !Number.isSafeInteger(input.version) || input.version < 0
    || !input.referenceId.trim()) {
    throw new RangeError('Valid Square order cancellation identity is required.');
  }
  return call(config, `/v2/orders/${encodeURIComponent(input.squareOrderId)}`, {
    method: 'PUT', token,
    body: {
      idempotency_key: `cancel-${input.referenceId}`,
      order: {
        location_id: input.squareLocationId,
        version: input.version,
        state: 'CANCELED',
      },
    },
  });
}
