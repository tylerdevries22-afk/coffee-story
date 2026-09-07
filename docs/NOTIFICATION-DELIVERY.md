# Notification delivery recovery

Push and SMS providers do not give these transports a caller-controlled idempotency
key. They retry explicit HTTP 429 rejections once. A lost connection, response-body
timeout, HTTP 5xx, or unreadable push receipt can occur after acceptance; those
outcomes raise `delivery_uncertain` without automatically repeating the send.
Email retries reuse one Resend idempotency key within each send invocation.

Operation notification outbox rows with uncertain outcomes become `cancelled`
with `last_error = delivery_uncertain`. Expired `sending` leases are held the same
way: a worker may have reached the provider before losing its lease. Known
rejections retain the existing bounded retry schedule. A partial device batch
with any uncertain result is held as a whole so successful devices are not resent.

Operators can inspect held rows without exposing message bodies or device tokens:

```sql
select id, brand_id, occurrence_id, attempt_count, created_at
from public.operation_notification_outbox
where status = 'cancelled' and last_error = 'delivery_uncertain'
order by created_at desc;
```

Check provider delivery records and the operation's current state before taking
any recovery action. Do not bulk reset these rows to pending: that can duplicate
already delivered messages. A missing provider receipt is not proof of rejection.
If the delivery outcome cannot be established, leave the row held and use the
operation board as the source of truth. This policy trades automatic recovery of
an ambiguous send for avoiding a second application-initiated delivery; it does
not promise exactly-once delivery by providers or devices.
