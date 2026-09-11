-- Bind the provider payment identity, paid transition, and fee receipt in one
-- transaction. Refunds resolve by orders.square_payment_id, so acknowledging a
-- settlement without this binding makes successfully paid orders unrefundable.
create or replace function public.record_square_payment_settlement(
  target_order uuid,
  square_event text,
  square_payment text,
  settled_fee_cents bigint,
  square_event_type text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  target public.orders%rowtype;
  prior_event public.order_events%rowtype;
  prior_fee public.platform_fees%rowtype;
  gross_cents bigint;
  event_written boolean := false;
begin
  if square_event is null or pg_catalog.btrim(square_event) = ''
    or square_payment is null or pg_catalog.btrim(square_payment) = ''
    or settled_fee_cents is null then
    raise exception 'Square settlement identity and fee are required';
  end if;

  select * into target from public.orders where id = target_order for update;
  if target.id is null then raise exception 'order does not exist'; end if;
  if target.tender_type not in ('square_card', 'square_link') then
    raise exception 'order was not paid through Square';
  end if;
  if target.status = 'cancelled' then
    raise exception 'Square settled a cancelled order';
  end if;

  gross_cents := target.total_cents - target.stored_value_applied_cents;
  if gross_cents < 0 or settled_fee_cents < 0 or settled_fee_cents > gross_cents then
    raise exception 'invalid Square settlement amounts';
  end if;
  if target.square_payment_id is not null
    and target.square_payment_id <> square_payment then
    raise exception 'order is already bound to a different Square payment';
  end if;

  update public.orders set square_payment_id = square_payment where id = target.id;

  if target.status = 'created' then
    insert into public.order_events (
      brand_id, order_id, type, snapshot, square_event_id, source
    ) values (
      target.brand_id,
      target.id,
      'paid',
      pg_catalog.jsonb_build_object(
        'square_event', square_event_type,
        'square_event_id', square_event,
        'square_payment_id', square_payment
      ),
      square_event,
      'webhook'
    ) on conflict (square_event_id) do nothing;
    event_written := found;

    if not event_written then
      select * into prior_event from public.order_events
      where square_event_id = square_event;
      if prior_event.id is null
        or prior_event.order_id <> target.id or prior_event.type <> 'paid' then
        raise exception 'Square event is already bound to a different settlement';
      end if;
    end if;
  elsif target.status not in ('paid', 'in_progress', 'ready', 'picked_up', 'refunded') then
    raise exception 'order cannot accept a Square settlement in status %', target.status;
  end if;

  if gross_cents > 0 then
    select * into prior_fee from public.platform_fees
    where square_payment_id = square_payment for update;
    if prior_fee.id is not null then
      if prior_fee.order_id <> target.id
        or prior_fee.brand_id <> target.brand_id
        or prior_fee.location_id <> target.location_id
        or prior_fee.gross_cents <> gross_cents
        or prior_fee.fee_cents <> settled_fee_cents then
        raise exception 'Square payment is already bound to a different fee receipt';
      end if;
    else
      if exists (
        select 1 from public.platform_fees
        where order_id = target.id and square_payment_id <> square_payment
      ) then
        raise exception 'order already has a different Square fee receipt';
      end if;
      insert into public.platform_fees (
        brand_id, location_id, order_id, gross_cents, fee_cents,
        fee_bps_applied, square_payment_id
      ) values (
        target.brand_id,
        target.location_id,
        target.id,
        gross_cents,
        settled_fee_cents,
        pg_catalog.round(settled_fee_cents::numeric * 10000 / gross_cents)::integer,
        square_payment
      );
    end if;
  end if;

  return event_written;
end
$$;

revoke all on function public.record_square_payment_settlement(uuid, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.record_square_payment_settlement(uuid, text, text, bigint, text)
  to service_role;

select app.register_release('20260908030000', 'record Square payment settlement');
