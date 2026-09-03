import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dependencyReports,
  overallState,
  overallSummary,
  stateLabel,
  stateTone,
  statusIncidents,
  type DependencyKey,
  type ProbeOutcome,
} from './status-report';

const OBSERVED_AT = '2026-09-03T12:00:00.000Z';

function reportsFor(outcomes: Partial<Record<DependencyKey, ProbeOutcome>>) {
  return dependencyReports(outcomes);
}

describe('dependencyReports', () => {
  it('always resolves every declared dependency in a fixed order', () => {
    const reports = reportsFor({ ordering: 'answered' });
    assert.deepEqual(reports.map((report) => report.key), ['ordering', 'order-updates', 'platform-api']);
  });

  /**
   * The stub this replaced rendered a pill reading "status pending monitoring
   * hookup" for every row, forever. An unprobed dependency must still say it
   * was not checked -- but it must never be reported as operational.
   */
  it('reports an unprobed dependency as unknown, never operational', () => {
    const [ordering] = reportsFor({});
    assert.equal(ordering?.state, 'unknown');
    assert.match(ordering?.note ?? '', /not checked/i);
  });

  it('maps each probe outcome onto its own state', () => {
    const reports = reportsFor({
      ordering: 'answered',
      'order-updates': 'failed',
      'platform-api': 'impaired',
    });
    assert.deepEqual(reports.map((report) => report.state), ['operational', 'outage', 'degraded']);
  });

  it('carries no probe input into the rendered copy', () => {
    const reports = reportsFor({ ordering: 'answered' });
    for (const report of reports) {
      assert.ok(report.name.length > 0);
      assert.ok(report.detail.length > 0);
      assert.ok(!/answered|impaired|unavailable/i.test(`${report.name} ${report.detail}`));
    }
  });
});

describe('overallState', () => {
  it('reports the worst dependency rather than the average', () => {
    assert.equal(overallState(reportsFor({
      ordering: 'answered',
      'order-updates': 'answered',
      'platform-api': 'failed',
    })), 'outage');
  });

  it('prefers an outage over a degradation and a degradation over unknown', () => {
    assert.equal(overallState(reportsFor({ ordering: 'impaired', 'order-updates': 'failed' })), 'outage');
    assert.equal(overallState(reportsFor({ ordering: 'impaired', 'order-updates': 'answered' })), 'degraded');
    assert.equal(overallState(reportsFor({ ordering: 'answered' })), 'unknown');
  });

  it('is operational only when every dependency answered', () => {
    assert.equal(overallState(reportsFor({
      ordering: 'answered',
      'order-updates': 'answered',
      'platform-api': 'answered',
    })), 'operational');
  });

  it('is unknown with nothing to report', () => {
    assert.equal(overallState([]), 'unknown');
  });
});

describe('statusIncidents', () => {
  it('raises one incident per failing dependency with its impact', () => {
    const incidents = statusIncidents(reportsFor({
      ordering: 'failed',
      'order-updates': 'answered',
      'platform-api': 'impaired',
    }), OBSERVED_AT);
    assert.deepEqual(incidents.map((incident) => incident.key), ['ordering', 'platform-api']);
    assert.match(incidents[0]?.title ?? '', /not answering/);
    assert.match(incidents[1]?.title ?? '', /degraded/);
    for (const incident of incidents) {
      assert.ok(incident.impact.length > 0);
      assert.equal(incident.observedAt, OBSERVED_AT);
    }
  });

  it('raises nothing while every dependency answers, and nothing for unknown', () => {
    assert.deepEqual(statusIncidents(reportsFor({
      ordering: 'answered',
      'order-updates': 'answered',
      'platform-api': 'answered',
    }), OBSERVED_AT), []);
    assert.deepEqual(statusIncidents(reportsFor({}), OBSERVED_AT), []);
  });
});

describe('state presentation', () => {
  it('labels and tones every state, and leaves unknown untinted', () => {
    assert.equal(stateLabel('operational'), 'Operational');
    assert.equal(stateTone('operational'), 'success');
    assert.equal(stateTone('degraded'), 'warning');
    assert.equal(stateTone('outage'), 'danger');
    assert.equal(stateTone('unknown'), '');
  });

  it('summarises each state in one sentence', () => {
    for (const state of ['operational', 'degraded', 'outage', 'unknown'] as const) {
      assert.ok(overallSummary(state).endsWith('.'));
    }
    assert.notEqual(overallSummary('operational'), overallSummary('unknown'));
  });
});
