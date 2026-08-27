-- The public invoker wrapper keeps the RPC safe for the API surface; the
-- unexposed helper is callable only through that wrapper for an authenticated
-- guest request.
grant execute on function app.mark_order_arrived(uuid) to authenticated;
