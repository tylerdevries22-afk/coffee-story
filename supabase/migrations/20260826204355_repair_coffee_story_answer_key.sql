-- The initial seed release intentionally keeps answer keys out of the public
-- manifest. Repair the private server key if an earlier seed ran before the
-- nested JSON path was created correctly.
update public.training_releases
set answer_key = jsonb_build_object(
  'knowledge', jsonb_build_object('coffee-story-menu', '[0,1]'::jsonb, 'flavor-and-allergen-guidance', '[0,1]'::jsonb, 'quality-standard', '[0,1]'::jsonb),
  'skills', jsonb_build_object('espresso-execution', '[0,1]'::jsonb, 'milk-and-beverage-prep', '[0,1]'::jsonb, 'station-setup-and-close', '[0,1]'::jsonb),
  'service', jsonb_build_object('welcome-and-order-accuracy', '[0,1]'::jsonb, 'customization-and-pickup', '[0,1]'::jsonb, 'recovery-and-escalation', '[0,1]'::jsonb),
  'safety', jsonb_build_object('food-and-allergen-safety', '[0,1]'::jsonb, 'equipment-and-heat-safety', '[0,1]'::jsonb, 'chemicals-and-incidents', '[0,1]'::jsonb),
  'operations', jsonb_build_object('open-close-and-handoff', '[0,1]'::jsonb, 'inventory-and-availability', '[0,1]'::jsonb, 'cash-privacy-and-escalation', '[0,1]'::jsonb)
), updated_at = now()
where brand_id = (select id from public.brands where slug = 'coffee-story' limit 1)
  and status = 'published'
  and template_key = 'coffee-story'
  and answer_key = '{}'::jsonb;
