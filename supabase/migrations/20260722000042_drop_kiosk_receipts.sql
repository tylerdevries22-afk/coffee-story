-- 0042: remove the projection nothing reads.
--
-- 0034 added `public.kiosk_receipts` on the reasoning that a receipt screen
-- needs a ticket number and a name, and should not reach `orders` to get them.
-- That reasoning was sound and the conclusion was still wrong, because it
-- answered a question nobody had asked: the kiosk reads nothing at all. There
-- is no Supabase client in `apps/kiosk/src`, no `@platform/data` import and no
-- `.from('orders')`. Its two network calls are `placeOrder` and the pairing
-- fetch, and the ticket arrives on the placeOrder response. Even the timeout
-- path needs no read -- a retry presents the same Idempotency-Key and the
-- server returns the original order with its number.
--
-- So this view has been a grant to `anon` and `authenticated` that buys
-- nothing since the day it landed. 0041 dropped the policy for the same
-- reason; this drops the projection that was meant to replace it. A read that
-- does not exist needs no grant, and the honest time to add one back is when
-- something actually reads -- with `orders.device_id` in it, which 0038 added
-- and which would scope such a read to one till rather than a location.
--
-- Deleting rather than keeping it "in case": an unread view still appears in
-- the schema, still has to be reasoned about by whoever audits grants next,
-- and is three lines to re-add.

drop view if exists public.kiosk_receipts;

-- Only that view called it.
drop function if exists app.can_read_receipt(uuid, uuid);
