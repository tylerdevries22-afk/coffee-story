import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findBlockingAdvisors, type AdvisorNotice } from '../../../scripts/hosted-migrations.ts';

const advisor = (arguments_: string): AdvisorNotice => ({
  level: 'WARN',
  metadata: {
    arguments: arguments_,
    name: 'acknowledge_knowledge_resource',
    schema: 'public',
  },
  name: 'authenticated_security_definer_function_executable',
  title: 'Signed-In Users Can Execute SECURITY DEFINER Function',
});

describe('hosted advisor policy', () => {
  it('accepts an exact audited client-callable definer identity', () => {
    assert.deepEqual(findBlockingAdvisors([
      advisor('p_resource_id uuid'),
    ]), []);
  });

  it('fails closed when an approved function signature changes', () => {
    assert.deepEqual(findBlockingAdvisors([
      advisor('p_resource_id uuid, p_scope text'),
    ]).length, 1);
  });

  it('continues to block unrelated warnings and errors', () => {
    const notices: AdvisorNotice[] = [
      { level: 'WARN', name: 'new_warning', title: 'Warning' },
      { level: 'ERROR', name: 'new_error', title: 'Error' },
      { level: 'INFO', name: 'informational', title: 'Information' },
    ];
    assert.deepEqual(findBlockingAdvisors(notices).map(({ name }) => name), [
      'new_warning',
      'new_error',
    ]);
  });
});
