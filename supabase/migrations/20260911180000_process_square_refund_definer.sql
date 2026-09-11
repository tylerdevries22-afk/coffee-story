-- 227000's CREATE is security invoker (surfaces tests grep that body). The
-- bounded-claim assertion and pgTAP RPC contract require DEFINER + empty
-- search_path + service_role execute, same as every other fee RPC. ALTER the
-- live function without rewriting the CREATE the schema tests read.

alter function public.process_square_refund(uuid, text, text, bigint, text)
  security definer;

create or replace function app.assert_process_square_refund_definer()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  rpc constant text := 'public.process_square_refund(uuid,text,text,bigint,text)';
  rpc_proc pg_catalog.pg_proc%rowtype;
begin
  select proc.* into rpc_proc from pg_catalog.pg_proc proc
  where proc.oid = pg_catalog.to_regprocedure(rpc);
  if rpc_proc.oid is null or not rpc_proc.prosecdef
    or not ('search_path=""' = any(coalesce(rpc_proc.proconfig, '{}'::text[])))
    or pg_catalog.has_function_privilege('anon', rpc, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', rpc, 'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role', rpc, 'EXECUTE') then
    raise exception 'process_square_refund must be definer-secured for service_role';
  end if;
end $$;

revoke all on function app.assert_process_square_refund_definer()
  from public, anon, authenticated;
grant execute on function app.assert_process_square_refund_definer()
  to service_role;

select app.register_release(
  '20260911180000',
  'process_square_refund security definer to match fee RPC contract',
  'app.assert_process_square_refund_definer()'::regprocedure
);
