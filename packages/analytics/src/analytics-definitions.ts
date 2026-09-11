import type { AnalyticsFunnelDefinition, AnalyticsMetricDefinition } from './analytics-types';
import { fail, isIdentifier } from './analytics-validation';

/** Validates a stable, ordered funnel definition. */
export function validateFunnelDefinition(definition: AnalyticsFunnelDefinition): AnalyticsFunnelDefinition {
  const issues: string[] = [];
  if (!isIdentifier(definition.key)) issues.push('Funnel key must be a stable identifier');
  if (!Number.isInteger(definition.version) || definition.version < 1) issues.push('Funnel version must be positive');
  if (!definition.label.trim() || definition.label.length > 120) issues.push('Funnel label must contain 1-120 characters');
  if (definition.steps.length < 2 || definition.steps.length > 20) issues.push('Funnels require 2-20 steps');
  const keys = new Set<string>();
  definition.steps.forEach((step, index) => {
    if (!isIdentifier(step.key)) issues.push(`Invalid funnel step key at index ${index}`);
    if (!step.label.trim() || step.label.length > 120) issues.push(`Invalid funnel step label at index ${index}`);
    if (step.order !== index) issues.push('Funnel step order must be zero-based and contiguous');
    if (keys.has(step.key)) issues.push(`Duplicate funnel step key: ${step.key}`);
    keys.add(step.key);
  });
  if (issues.length) fail('INVALID_FUNNEL', issues);
  return Object.freeze({ ...definition, steps: Object.freeze(definition.steps.map((step) => Object.freeze({ ...step }))) });
}

/** Validates a metric definition that can be resolved without tenant-authored SQL. */
export function validateMetricDefinition(definition: AnalyticsMetricDefinition): AnalyticsMetricDefinition {
  const issues: string[] = [];
  if (!isIdentifier(definition.key)) issues.push('Metric key must be a stable identifier');
  if (!Number.isInteger(definition.version) || definition.version < 1) issues.push('Metric version must be positive');
  if (!definition.label.trim() || definition.label.length > 120) issues.push('Metric label must contain 1-120 characters');
  const needsPercentile = definition.formula === 'duration_percentile';
  if (needsPercentile !== (definition.percentile !== undefined)) {
    issues.push('Only duration_percentile metrics require a percentile');
  }
  if (issues.length) fail('INVALID_METRIC', issues);
  return Object.freeze({ ...definition });
}
