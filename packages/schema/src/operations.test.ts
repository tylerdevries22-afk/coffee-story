import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

const migration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations',
  '20260828000000_tenant_operations.sql'), 'utf8');
const hardening = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations',
  '20260828051242_harden_tenant_operations_runtime.sql'), 'utf8');
const advisorHardening = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations',
  '20260828104000_harden_operation_rpc_boundaries.sql'), 'utf8');
const releaseHardening = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations',
  '20260828130000_operations_release_hardening.sql'), 'utf8');
const reviewFixes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations',
  '20260828144328_operations_release_review_fixes.sql'), 'utf8');
const volatilityFix = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations',
  '20260828152200_release_readiness_volatility.sql'), 'utf8');
const competencyAward = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations',
  '20260828163000_award_training_competencies.sql'), 'utf8');
const operationsSql = `${migration}\n${hardening}\n${advisorHardening}\n${releaseHardening}\n${reviewFixes}\n${volatilityFix}\n${competencyAward}`;

describe('tenant operations migration', () => {
  it('keeps the platform schema industry-neutral', () => {
    assert.doesNotMatch(migration, /bathroom|restroom|coffee shop/i);
  });

  it('uses composite tenant foreign keys for location-owned records', () => {
    for (const table of ['operation_task_templates', 'operation_schedules', 'operation_occurrences', 'operation_issues']) {
      assert.match(migration, new RegExp(`create table public\\.${table} \\([\\s\\S]*?brand_id uuid not null`));
    }
    assert.match(migration, /foreign key \(location_id, brand_id\)[\s\S]*?references public\.locations \(id, brand_id\)/);
  });

  it('does not grant clients mutation rights over occurrence history', () => {
    assert.doesNotMatch(operationsSql,
      /grant\s+(?:(?:all|insert|update|delete)(?:\s*,\s*(?:all|insert|update|delete))*)\s+on\s+[^;]*operation_occurrence_events[^;]*to authenticated;/i);
    assert.match(hardening, /drop function public\.claim_operation_occurrence\(uuid\)/);
    assert.match(hardening,
      /grant execute on function public\.claim_operation_occurrence\(uuid, uuid\) to authenticated/);
  });

  it('makes materialization and escalation delivery idempotent', () => {
    assert.match(migration, /unique \(brand_id, materialization_key\)/);
    assert.match(migration, /unique \(occurrence_id, escalation_rule_id, recipient_id, channel\)/);
    assert.match(releaseHardening, /queue_due_operation_escalations/);
    assert.match(releaseHardening, /status in \('pending', 'failed', 'sending'\)/);
  });

  it('keeps each read-only release contract stable', () => {
    assert.match(reviewFixes,
      /create or replace function public\.platform_release_readiness\(\)\s+returns text language plpgsql stable security invoker/);
    assert.match(volatilityFix,
      /alter function app\.platform_release_readiness_20260828130000\(\) stable/);
    assert.match(volatilityFix,
      /create or replace function public\.platform_release_readiness\(\)\s+returns text language plpgsql stable security invoker/);
    assert.match(competencyAward,
      /create or replace function public\.platform_release_readiness\(\)\s+returns text language plpgsql stable security invoker/);
  });

  it('issues training competencies through one tenant-safe idempotent contract', () => {
    assert.match(competencyAward, /create or replace function public\.award_operation_competency/);
    assert.match(competencyAward, /progress\.status = 'completed'/);
    assert.match(competencyAward, /release\.status = 'published'/);
    assert.match(competencyAward, /lesson -> 'grantsCompetencyKeys'/);
    assert.match(competencyAward, /pg_advisory_xact_lock/);
    assert.match(competencyAward, /target_action_id::text/);
    assert.match(competencyAward, /award\.action_id = target_action_id/);
    assert.match(competencyAward,
      /revoke all on function public\.award_operation_competency\([\s\S]*?from public, anon, authenticated;/);
    assert.match(competencyAward,
      /grant execute on function public\.award_operation_competency\([\s\S]*?to service_role;/);
  });

  it('suppresses queued and claimed deliveries when operations are disabled', () => {
    assert.match(releaseHardening,
      /join public\.brands brand on brand\.id = occurrence\.brand_id and brand\.operations/);
    assert.match(releaseHardening, /set status = 'cancelled', last_error = 'operations_disabled'/);
    assert.match(releaseHardening,
      /join public\.brands brand on brand\.id = outbox\.brand_id and brand\.operations/);
    assert.doesNotMatch(reviewFixes, /with recipients as/);
    assert.match(reviewFixes,
      /exists \(select 1 from public\.brands brand[\s\S]*?brand\.operations\)/);
  });

  it('allows one active tenant owner per physical operation device', () => {
    assert.match(reviewFixes,
      /create unique index operation_devices_active_token_key[\s\S]*?where is_active/);
    assert.match(reviewFixes,
      /update public\.operation_staff_devices set is_active = false[\s\S]*?expo_push_token = normalized_token/);
    assert.match(reviewFixes, /pg_advisory_xact_lock/);
    assert.match(reviewFixes,
      /revoke all on function app\.register_operation_device\(uuid, text, text\)\s+from public, anon;/,
      'the public invoker wrapper needs the authenticated internal execute grant');
  });

  it('requires a current shift and an unexpired claim lease', () => {
    assert.match(releaseHardening, /shift\.starts_at <= now\(\)/);
    assert.match(releaseHardening, /shift\.ends_at > now\(\)/);
    assert.match(releaseHardening, /selected\.claim_expires_at <= now\(\)/);
  });

  it('exposes queue eligibility through an invoker-safe wrapper', () => {
    assert.match(releaseHardening,
      /create or replace function public\.operation_queue_eligibility\(target_occurrences uuid\[\]\)[\s\S]*?security invoker/);
    assert.match(releaseHardening,
      /revoke all on function app\.operation_queue_eligibility\(uuid\[\]\) from public, anon/);
  });

  it('aligns lifecycle values and exposes only idempotent runtime mutations', () => {
    assert.match(migration,
      /'scheduled', 'claimed', 'completed', 'missed', 'cancelled'/);
    for (const signature of [
      'claim_operation_occurrence\\(uuid, uuid\\)',
      'complete_operation_occurrence\\(uuid, uuid, jsonb, text, jsonb\\)',
      'release_operation_occurrence\\(uuid, uuid\\)',
      'cancel_operation_occurrence\\(uuid, uuid, text\\)',
      'resolve_operation_issue\\(uuid, uuid, text\\)',
    ]) assert.match(hardening, new RegExp(`grant execute on function public\\.${signature}`));
  });

  it('exposes invoker-safe RPC wrappers and keeps privileged implementations internal', () => {
    for (const name of [
      'acknowledge_operation_notification', 'cancel_operation_occurrence',
      'claim_operation_occurrence', 'complete_operation_occurrence',
      'create_manual_operation_occurrence', 'register_operation_device',
      'release_operation_occurrence', 'report_operation_issue',
      'resolve_operation_issue', 'unregister_operation_device', 'update_operation_issue',
    ]) {
      assert.match(advisorHardening, new RegExp(`alter function public\\.${name}\\([\\s\\S]*?set schema app;`));
      assert.match(advisorHardening,
        new RegExp(`create function public\\.${name}\\([\\s\\S]*?security invoker`));
    }
  });

  it('splits authoring rights by command so read policies are evaluated once', () => {
    for (const name of [
      'operation_templates', 'operation_steps', 'operation_schedules',
      'operation_escalations', 'operation_retention', 'training_competencies',
    ]) {
      assert.match(advisorHardening, new RegExp(`create policy ${name}_manage_insert`));
      assert.match(advisorHardening, new RegExp(`create policy ${name}_manage_update`));
      assert.match(advisorHardening, new RegExp(`create policy ${name}_manage_delete`));
    }
    assert.doesNotMatch(advisorHardening, /create policy \w+_manage on [^;]+ for all/i);
  });
});
