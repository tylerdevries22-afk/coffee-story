import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveInstallationStatus,
  evaluateConnectorReadiness,
  getConnectorCatalogEntry,
  isCertificationCurrent,
  type ConnectorDescriptor,
} from './index';

const now = new Date('2026-08-27T18:00:00.000Z');

function certifiedDescriptor(): ConnectorDescriptor {
  const square = getConnectorCatalogEntry('square');
  assert.ok(square);
  return {
    ...square.descriptor,
    certification: {
      evidenceIds: ['sandbox:2026-08-27'],
      expiresAt: '2026-09-27T18:00:00.000Z',
      state: 'certified',
    },
  };
}

describe('connector readiness', () => {
  it('accepts only a certified, unexpired certification', () => {
    const current = certifiedDescriptor().certification;
    assert.equal(isCertificationCurrent(current, now), true);
    assert.equal(isCertificationCurrent({ ...current, state: 'blocked' }, now), false);
    assert.equal(isCertificationCurrent({ ...current, expiresAt: 'invalid' }, now), false);
    assert.equal(
      isCertificationCurrent({ ...current, expiresAt: now.toISOString() }, now),
      false,
    );
  });

  it('derives explicit installation states in safety-first precedence', () => {
    assert.equal(deriveInstallationStatus(true, { configured: true, connected: true, revoked: true }), 'revoked');
    assert.equal(deriveInstallationStatus(true, { configured: true, connected: true, disabled: true }), 'disabled');
    assert.equal(deriveInstallationStatus(false, { configured: true, connected: true }), 'uncertified');
    assert.equal(deriveInstallationStatus(true, { configured: false, connected: false, providerApprovalRequired: true }), 'provider-approval-required');
    assert.equal(deriveInstallationStatus(true, { configured: false, connected: false }), 'setup-required');
    assert.equal(deriveInstallationStatus(true, { configured: true, connected: false, connecting: true }), 'connecting');
    assert.equal(deriveInstallationStatus(true, { configured: true, connected: true, authorizationValid: false }), 'reauthorization-required');
    assert.equal(deriveInstallationStatus(true, { configured: true, connected: false }), 'available');
    assert.equal(deriveInstallationStatus(true, { configured: true, connected: true, healthy: false }), 'connected-degraded');
    assert.equal(deriveInstallationStatus(true, { configured: true, connected: true, healthy: true }), 'connected-healthy');
  });

  it('opens only a configured, connected, certified connector with required guarantees', () => {
    const readiness = evaluateConnectorReadiness(
      certifiedDescriptor(),
      { authorizationValid: true, configured: true, connected: true, healthy: true },
      'staging',
      now,
    );

    assert.deepEqual(readiness, {
      blockers: [],
      ready: true,
      status: 'connected-healthy',
    });
  });

  it('fails closed and reports every missing readiness guarantee', () => {
    const descriptor = {
      ...certifiedDescriptor(),
      capabilities: [{ id: 'unsafe.write', idempotency: false, reconciliation: false, sandbox: false }],
      certification: { evidenceIds: [], state: 'uncertified' as const },
    };
    const readiness = evaluateConnectorReadiness(
      descriptor,
      { authorizationValid: false, configured: false, connected: false },
      'staging',
      now,
    );

    assert.deepEqual(readiness.blockers, [
      'certification-current', 'configured', 'connected', 'authorization-valid',
      'idempotency-supported', 'reconciliation-supported', 'sandbox-supported',
    ]);
    assert.equal(readiness.ready, false);
    assert.equal(readiness.status, 'uncertified');
  });
});
