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
const operationsSql = `${migration}\n${hardening}\n${advisorHardening}`;

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
