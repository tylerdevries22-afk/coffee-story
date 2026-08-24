-- 0041: undo a narrowing I reverted by accident, and grant the kiosk nothing.
--
-- 0034 dropped `orders_kiosk_select` deliberately and replaced it with a
-- projection, `public.kiosk_receipts` -- ticket number, guest label, status,
-- ten-minute window, and none of the cart. My 0038 then re-created a policy of
-- the same name, narrowed to `device_id = app.jwt_device_id()`.
--
-- Narrower than 0023's, but a step BACKWARDS from 0034: a policy on
-- `public.orders` grants every column of the rows it matches. A kiosk token
-- could read `customer_id`, `totals`, `note` and `square_payment_id` for the
-- orders that till created. A kiosk is a tablet bolted to a counter in a public
-- room; a lifted token is an hour of that till's orders with guest ids
-- attached. The projection is the privilege -- the same argument that made
-- `board_tickets` a view rather than a policy.
--
-- The resolution is simpler than restoring either one. The kiosk does not read
-- `orders` AT ALL: it holds no Supabase client, imports no @platform/data, and
-- gets its ticket from the `dailyNumber` field on the POST /api/orders
-- response. The timeout path needs no read either -- a retry presents the same
-- Idempotency-Key and the server returns the original order, ticket included.
--
-- So the grant goes away entirely. A read that does not exist needs no policy,
-- and the right time to add one back is when something actually reads.

drop policy if exists orders_kiosk_select on public.orders;

-- `orders.device_id` (0038) STAYS. It is not a grant, it is attribution: which
-- till rang which sale, which the analytics views will want, and which is what
-- would let a future receipt read be scoped to one device rather than to a
-- location. Keeping the column while dropping the policy is the whole point --
-- the data is recorded, the privilege is not handed out.

comment on column public.orders.device_id is
  'Which paired device took the order. Null for app and web. Attribution only: '
  'no client policy grants a device access to public.orders, and the kiosk reads '
  'its ticket from the placeOrder response rather than from the table.';
