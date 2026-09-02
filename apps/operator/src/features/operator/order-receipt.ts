import { formatMoney } from '@platform/domain';

import type { BoardOrder } from './board';

export type OrderReceipt = {
  locationName: string;
  order: BoardOrder;
  printedAt: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function lineHtml(line: BoardOrder['lines'][number]): string {
  const detail = [...line.options, ...(line.note ? [`Note: ${line.note}`] : [])]
    .map((value) => `<div class="detail">${escapeHtml(value)}</div>`)
    .join('');
  const packs = (line.packContents ?? [])
    .map((item) => `<div class="detail">${item.quantity}&times; ${escapeHtml(item.name)}</div>`)
    .join('');
  return `<section class="item"><strong>${line.quantity}&times; ${escapeHtml(line.name)}</strong>${detail}${packs}</section>`;
}

/**
 * A network-free order summary for a local printer.
 *
 * This is intentionally not labelled a card-network receipt: the current
 * order row does not contain the EMV fields Square requires. The native
 * payment adapter must append those fields before this can replace Square's
 * official payment receipt.
 */
export function orderReceiptHtml(input: OrderReceipt, attempt = 1): string {
  const { order } = input;
  const payment = order.status === 'created' && order.tenderType === 'pay_at_pickup'
    ? 'PAYMENT DUE'
    : 'ORDER PAID';
  const duplicate = attempt > 1
    ? '<div class="warning">COPY &mdash; VERIFY BEFORE MAKING</div>'
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@page{margin:4mm}body{font:13px -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;color:#111;margin:0}
h1{font-size:20px;margin:0 0 3px;text-align:center}.center{text-align:center}.rule{border-top:1px dashed #333;margin:10px 0}
.item{margin:9px 0}.detail{font-size:11px;margin:2px 0 0 14px}.total{display:flex;justify-content:space-between;font-size:17px;font-weight:700}
.warning{border:2px solid #111;font-weight:800;margin-bottom:10px;padding:6px;text-align:center}.fine{font-size:9px;overflow-wrap:anywhere}
</style></head><body>${duplicate}<h1>${escapeHtml(input.locationName)}</h1>
<div class="center">Order ${escapeHtml(order.shortCode)} &middot; ${escapeHtml(order.guestName)}</div>
<div class="center">${escapeHtml(new Date(input.printedAt).toLocaleString('en-US'))}</div><div class="rule"></div>
${order.lines.map(lineHtml).join('')}${order.note ? `<div><strong>Order note:</strong> ${escapeHtml(order.note)}</div>` : ''}
<div class="rule"></div><div class="total"><span>Total</span><span>${escapeHtml(formatMoney(order.totalCents))}</span></div>
<div class="center"><strong>${payment}</strong></div><div class="rule"></div>
<div class="center fine">Order ID ${escapeHtml(order.id)}</div>
<div class="center fine">The payment processor issues the official card receipt.</div></body></html>`;
}
