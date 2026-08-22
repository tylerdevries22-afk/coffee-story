-- 0006: campaigns. Audience is a stored filter the engine evaluates at send
-- time; stats accumulate as the send runs.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  channel app.campaign_channel not null,
  name text not null,
  subject text not null default '',
  body text not null default '',
  -- e.g. {"kind":"all"} | {"kind":"lapsed","days":30} | {"kind":"loyalty_tier","min_points":500}
  audience jsonb not null default '{"kind":"all"}'::jsonb,
  scheduled_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  -- {"queued":0,"sent":0,"failed":0,"opened":0,"redeemed":0}
  stats jsonb not null default '{}'::jsonb,
  drop_id uuid references public.drops (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_brand_idx on public.campaigns (brand_id, created_at desc);

create trigger campaigns_touch before update on public.campaigns
  for each row execute function app.touch_updated_at();
