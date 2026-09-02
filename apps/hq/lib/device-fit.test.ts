import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ARTWORK, chassisSize, chassisTransform, deviceRectVars, fitRotatedDevice } from './device-fit';

const stage = { width: 400, height: 300 };
const chassis = chassisSize({ width: 1180, height: 884 }, ARTWORK.tablet);

test('0 degrees matches the legacy landscape fit', () => {
  const legacyScale = Math.min(stage.width / chassis.width, stage.height / chassis.height);
  const fit = fitRotatedDevice(stage, chassis, 0);
  assert.ok(Math.abs(fit.scale - legacyScale) < 1e-12);
  assert.ok(Math.abs(fit.left - (stage.width - chassis.width * legacyScale) / 2) < 1e-9);
  assert.ok(Math.abs(fit.top - (stage.height - chassis.height * legacyScale) / 2) < 1e-9);
});

test('90 degrees fits the swapped box', () => {
  const fit = fitRotatedDevice(stage, chassis, 90);
  assert.ok(Math.abs(fit.scale - Math.min(stage.width / chassis.height, stage.height / chassis.width)) < 1e-9);
  assert.ok(Math.abs(fit.width - chassis.height * fit.scale) < 1e-9);
});

test('45 degrees shrinks the scale for the diagonal', () => {
  assert.ok(fitRotatedDevice(stage, chassis, 45).scale < Math.min(fitRotatedDevice(stage, chassis, 0).scale, fitRotatedDevice(stage, chassis, 90).scale));
});

test('device rect vars are px strings', () => {
  const vars = deviceRectVars(fitRotatedDevice(stage, chassis, 90));
  assert.match(vars['--device-left'] ?? '', /px$/);
  assert.match(vars['--device-height'] ?? '', /px$/);
  assert.equal(vars['--device-angle'], '90deg');
  assert.match(chassisTransform(fitRotatedDevice(stage, chassis, 0), chassis), /rotate\(0deg\) scale\(/);
});
