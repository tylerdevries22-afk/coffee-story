-- Account deletion keeps the customer row because orders retain it as their
-- historical owner. PII and delivery tokens leave together in one transaction;
-- user_id stays until GoTrue deletes auth.users, making a failed auth deletion
-- safely retryable with the same signed-in account.
create or replace function public.anonymize_customer_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_tokens
  where customer_id in (
    select id from public.customers where user_id = p_user_id
  );

  update public.customers
  set full_name = 'Deleted account',
      email = null,
      phone = null,
      push_token = null,
      sms_opt_in = false
  where user_id = p_user_id;
end;
$$;

revoke all on function public.anonymize_customer_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_customer_account(uuid) to service_role;
