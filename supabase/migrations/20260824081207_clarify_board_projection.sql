-- Keep the public contract explicit and repeat the authorization gate outside
-- the privileged helper. Besides making audits mechanically reliable, this is
-- defense in depth if the helper is ever broadened independently.
create or replace view public.board_tickets
with (security_barrier = true, security_invoker = true) as
  select ticket.id,
         ticket.brand_id,
         ticket.location_id,
         ticket.daily_number,
         ticket.guest_label,
         ticket.status,
         ticket.fulfillment_type,
         ticket.channel,
         ticket.arrived_at,
         ticket.loyalty_tier,
         ticket.updated_at
    from app.board_ticket_rows() ticket
   where app.can_read_board(ticket.brand_id, ticket.location_id);

grant select on public.board_tickets to authenticated, anon;
revoke insert, update, delete on public.board_tickets from anon, authenticated;
