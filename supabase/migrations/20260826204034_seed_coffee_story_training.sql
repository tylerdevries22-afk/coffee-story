-- Idempotent Coffee Story seed: a portable five-track template and a first
-- published release. The brand is resolved by slug, never by a copied UUID.
do $seed$
declare
  target_brand uuid;
  run_id uuid;
  profile jsonb := jsonb_build_object(
    'businessName', 'Coffee Story', 'industry', 'Specialty coffee shop and café',
    'locale', 'en-US', 'templateKey', 'coffee-story', 'templateVersion', 1,
    'products', jsonb_build_array('Espresso', 'Tea', 'Pastries')
  );
  sources jsonb := jsonb_build_array(
    jsonb_build_object('title', 'Coffee standards', 'url', 'https://sca.coffee/research/coffee-standards', 'publisher', 'Specialty Coffee Association', 'accessedAt', '2026-08-26'),
    jsonb_build_object('title', 'FDA Food Code', 'url', 'https://www.fda.gov/food/retail-food-protection/fda-food-code', 'publisher', 'U.S. Food and Drug Administration', 'accessedAt', '2026-08-26'),
    jsonb_build_object('title', 'Restaurant safety', 'url', 'https://www.osha.gov/etools/young-workers-restaurant-safety', 'publisher', 'Occupational Safety and Health Administration', 'accessedAt', '2026-08-26')
  );
  tracks jsonb := jsonb_build_array(
    jsonb_build_object('key', 'knowledge', 'title', 'Knowledge', 'summary', 'Products, standards, and guest-ready explanations.', 'symbol', 'book-open', 'source', 'https://sca.coffee/research/coffee-standards', 'lessons', jsonb_build_array(jsonb_build_object('slug', 'coffee-story-menu', 'title', 'Tell the Coffee Story menu', 'objective', 'Explain the menu in a clear, guest-ready way'), jsonb_build_object('slug', 'flavor-and-allergen-guidance', 'title', 'Flavor and allergen guidance', 'objective', 'Handle flavor questions and allergy concerns safely'), jsonb_build_object('slug', 'quality-standard', 'title', 'Recognize the quality standard', 'objective', 'Describe what a consistent Coffee Story beverage looks and tastes like'))),
    jsonb_build_object('key', 'skills', 'title', 'Skills', 'summary', 'Repeatable beverage execution and station habits.', 'symbol', 'wrench', 'source', 'https://sca.coffee/research/coffee-standards', 'lessons', jsonb_build_array(jsonb_build_object('slug', 'espresso-execution', 'title', 'Execute an espresso recipe', 'objective', 'Follow the approved espresso recipe and check the result'), jsonb_build_object('slug', 'milk-and-beverage-prep', 'title', 'Prepare milk and beverages', 'objective', 'Steam, pour, and finish beverages consistently'), jsonb_build_object('slug', 'station-setup-and-close', 'title', 'Set up and close the station', 'objective', 'Prepare a clean station and leave it ready for the next shift'))),
    jsonb_build_object('key', 'service', 'title', 'Service', 'summary', 'Warm, accurate, and calm guest interactions.', 'symbol', 'star', 'source', 'https://www.osha.gov/etools/young-workers-restaurant-safety', 'lessons', jsonb_build_array(jsonb_build_object('slug', 'welcome-and-order-accuracy', 'title', 'Welcome and capture an accurate order', 'objective', 'Greet every guest and confirm the order before payment'), jsonb_build_object('slug', 'customization-and-pickup', 'title', 'Handle customizations and pickup', 'objective', 'Repeat modifications and complete a confident handoff'), jsonb_build_object('slug', 'recovery-and-escalation', 'title', 'Recover and escalate well', 'objective', 'Resolve a service miss and involve a lead at the right time'))),
    jsonb_build_object('key', 'safety', 'title', 'Safety', 'summary', 'Food, equipment, chemical, and incident safety.', 'symbol', 'lock', 'source', 'https://www.fda.gov/food/retail-food-protection/fda-food-code', 'lessons', jsonb_build_array(jsonb_build_object('slug', 'food-and-allergen-safety', 'title', 'Protect food and allergen safety', 'objective', 'Use safe handling and clear allergen communication'), jsonb_build_object('slug', 'equipment-and-heat-safety', 'title', 'Work safely around equipment and heat', 'objective', 'Prevent burns, electrical incidents, and unsafe equipment use'), jsonb_build_object('slug', 'chemicals-and-incidents', 'title', 'Handle chemicals and incidents', 'objective', 'Use labeled chemicals and report an incident immediately'))),
    jsonb_build_object('key', 'operations', 'title', 'Operations', 'summary', 'Opening, inventory, records, and shift handoff.', 'symbol', 'briefcase', 'source', 'https://www.osha.gov/etools/young-workers-restaurant-safety', 'lessons', jsonb_build_array(jsonb_build_object('slug', 'open-close-and-handoff', 'title', 'Open, close, and hand off', 'objective', 'Complete the shift checklist and leave useful notes'), jsonb_build_object('slug', 'inventory-and-availability', 'title', 'Manage inventory and availability', 'objective', 'Spot low stock early and follow the approved 86 workflow'), jsonb_build_object('slug', 'cash-privacy-and-escalation', 'title', 'Protect cash, privacy, and records', 'objective', 'Keep operational records secure and escalate exceptions')))
  );
  modules jsonb := '[]'::jsonb;
  answer_key jsonb := '{}'::jsonb;
  manifest jsonb;
  track jsonb;
  lesson_seed jsonb;
  lessons jsonb;
  track_key text;
  lesson_slug text;
  lesson_index integer;
begin
  select id into target_brand from public.brands where slug = 'coffee-story' limit 1;

  -- Migrations run before the onboarding seed on a fresh database. Always
  -- publish the reusable template, but only materialize the tenant release
  -- when the tenant already exists. `pnpm onboard` can then seed the brand
  -- and the idempotent training bootstrap can publish its first release.
  for track in select value from jsonb_array_elements(tracks) loop
    track_key := track->>'key';
    lessons := '[]'::jsonb;
    for lesson_index in 0..2 loop
      lesson_seed := track->'lessons'->lesson_index;
      lesson_slug := lesson_seed->>'slug';
      lessons := lessons || jsonb_build_array(jsonb_build_object(
        'slug', lesson_slug, 'title', lesson_seed->>'title', 'objective', lesson_seed->>'objective',
        'content', (lesson_seed->>'objective') || '. Follow the current Coffee Story procedure, verify the result against the station standard, and ask a shift lead whenever the situation falls outside the documented process. Record the handoff so the next operator can continue safely and consistently.',
        'estimatedMinutes', 8, 'sourceUrls', jsonb_build_array(track->>'source'), 'media', jsonb_build_array(),
        'quiz', jsonb_build_array(
          jsonb_build_object('prompt', 'What is the safest first step?', 'choices', jsonb_build_array('Follow the approved procedure', 'Guess from memory', 'Skip the check'), 'explanation', 'The approved procedure is the tenant source of truth.'),
          jsonb_build_object('prompt', 'What should you do when the situation is not covered?', 'choices', jsonb_build_array('Continue anyway', 'Ask a shift lead', 'Hide the issue'), 'explanation', 'Escalation protects guests, operators, and the business.')
        )
      ));
      answer_key := answer_key || jsonb_build_object(
        track_key,
        coalesce(answer_key->track_key, '{}'::jsonb) || jsonb_build_object(lesson_slug, '[0,1]'::jsonb)
      );
    end loop;
    modules := modules || jsonb_build_array(jsonb_build_object(
      'slug', track_key, 'trackKey', track_key, 'sortOrder', jsonb_array_length(modules),
      'title', track->>'title', 'summary', track->>'summary',
      'icon', jsonb_build_object('symbol', track->>'symbol', 'prompt', 'Simple monochrome ' || track_key || ' line icon'),
      'lessons', lessons
    ));
  end loop;
  manifest := jsonb_build_object('schemaVersion', 2, 'generatedAt', now(), 'tenant', profile, 'sources', sources, 'modules', modules);

  insert into public.training_templates (template_key, version, industry, locale, manifest, status)
  values ('coffee-story', 1, 'Specialty coffee shop and café', 'en-US', manifest, 'published')
  on conflict (template_key, version) do update set manifest = excluded.manifest, status = 'published', updated_at = now();

  if target_brand is not null then
    if not exists (select 1 from public.training_releases release where release.brand_id = target_brand and release.status = 'published' and release.manifest->>'schemaVersion' = '2') then
      select id into run_id from public.training_bootstrap_runs where brand_id = target_brand and profile_fingerprint = 'coffee-story-v2-baseline-20260826' and pipeline_version = '2.0.0' limit 1;
      if run_id is null then
        insert into public.training_bootstrap_runs (brand_id, profile_fingerprint, pipeline_version, trigger_kind, status, stage, progress, finished_at)
        values (target_brand, 'coffee-story-v2-baseline-20260826', '2.0.0', 'manual', 'published', 'complete', 100, now()) returning id into run_id;
      end if;
      perform public.publish_training_release(target_brand, run_id, manifest, answer_key);
      update public.training_bootstrap_runs set status = 'published', stage = 'complete', progress = 100, finished_at = now() where id = run_id;
    end if;
  end if;
end $seed$;
