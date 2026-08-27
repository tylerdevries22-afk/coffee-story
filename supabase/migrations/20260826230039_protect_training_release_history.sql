-- Enforce the release contract at the database boundary. HQ edits drafts and
-- publication only changes lifecycle metadata; an already published or
-- retired manifest can never be rewritten by a privileged worker or a future
-- admin tool.

create or replace function app.protect_training_release_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('published', 'retired') then
      raise exception using errcode = '55006', message = 'training_release_immutable';
    end if;
    return old;
  end if;

  if old.status in ('published', 'retired') then
    if new.brand_id is distinct from old.brand_id
       or new.bootstrap_run_id is distinct from old.bootstrap_run_id
       or new.version is distinct from old.version
       or new.manifest is distinct from old.manifest
       or new.answer_key is distinct from old.answer_key
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.template_key is distinct from old.template_key
       or new.template_version is distinct from old.template_version
       or new.base_release_id is distinct from old.base_release_id
       or new.validated_at is distinct from old.validated_at
       or new.published_at is distinct from old.published_at then
      raise exception using errcode = '55006', message = 'training_release_immutable';
    end if;
    if old.status = 'retired' and new.status is distinct from old.status then
      raise exception using errcode = '55006', message = 'training_release_retired';
    end if;
    if old.status = 'published' and new.status not in ('published', 'retired') then
      raise exception using errcode = '55006', message = 'training_release_lifecycle';
    end if;
  end if;
  return new;
end
$$;

revoke all on function app.protect_training_release_history() from public, anon, authenticated;
drop trigger if exists training_releases_protect_history on public.training_releases;
create trigger training_releases_protect_history
  before update or delete on public.training_releases
  for each row execute function app.protect_training_release_history();

comment on function app.protect_training_release_history() is
  'Prevents rewriting published or retired training contracts while allowing atomic lifecycle retirement.';
