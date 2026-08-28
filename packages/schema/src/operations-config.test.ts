import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseTenantOperations,
  type TenantOperationsConfig,
} from './operations-config';

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const VALID_CONFIG: TenantOperationsConfig = {
  roles: [{ key: 'floor-operations', title: 'Floor operations', description: 'Runs location routines.' }],
  competencies: [{ key: 'safe-service', title: 'Safe service', renewalDays: 365 }],
  templates: [{
    key: 'opening-routine',
    programKey: 'opening-program',
    routineKind: 'opening',
    revision: 1,
    title: 'Opening routine',
    instructions: 'Prepare the location for service.',
    estimatedMinutes: 20,
    requiredRoleKeys: ['floor-operations'],
    requiredCompetencyKeys: ['safe-service'],
    issueCategories: ['safety', 'supplies'],
    steps: [
      {
        key: 'unlock',
        title: 'Unlock the service area',
        instructions: '',
        responseKind: 'confirm',
        required: true,
        issueOnFailure: false,
        allowNotApplicable: false,
        constraints: {},
      },
      {
        key: 'inspect',
        title: 'Inspect the service area',
        instructions: '',
        responseKind: 'pass_fail',
        required: true,
        issueOnFailure: true,
        allowNotApplicable: false,
        constraints: {},
      },
      {
        key: 'temperature',
        title: 'Record the temperature',
        instructions: '',
        responseKind: 'number',
        required: true,
        issueOnFailure: false,
        allowNotApplicable: false,
        constraints: {},
      },
      {
        key: 'notes',
        title: 'Add a shift note',
        instructions: '',
        responseKind: 'text',
        required: false,
        issueOnFailure: false,
        allowNotApplicable: true,
        constraints: {},
      },
    ],
  }],
  schedules: [{
    key: 'weekday-opening',
    templateKey: 'opening-routine',
    rule: { kind: 'opening_offset', offsetMinutes: 0, weekdays: [1, 3, 5] },
    dueWindowMinutes: 45,
    graceMinutes: 10,
    activeFrom: '2026-01-01',
    activeUntil: '2026-12-31',
    enabled: true,
  }],
  escalations: [
    {
      scheduleKey: null,
      order: 1,
      offsetMinutes: 0,
      recipientRole: 'eligible_staff',
      channels: ['push'],
    },
    {
      scheduleKey: 'weekday-opening',
      order: 1,
      offsetMinutes: 15,
      recipientRole: 'location_manager',
      channels: ['in_app', 'push'],
    },
  ],
  retention: { evidenceDays: 365, issueDays: 730, actorIdentityDays: 365 },
};

function cloneConfig(): TenantOperationsConfig {
  return structuredClone(VALID_CONFIG);
}

function readArtifact(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(REPOSITORY_ROOT, relativePath), 'utf8')) as unknown;
}

function expectValid(value: unknown, enabled = true): TenantOperationsConfig {
  const result = parseTenantOperations(value, enabled);
  assert.deepEqual(result.errors, []);
  assert.ok(result.value);
  return result.value;
}

function expectInvalid(value: unknown, expected: RegExp, enabled = true): void {
  const result = parseTenantOperations(value, enabled);
  assert.equal(result.value, null);
  assert.ok(result.errors.length > 0);
  assert.match(result.errors.join('\n'), expected);
}

function firstTemplate(config: TenantOperationsConfig) {
  const template = config.templates[0];
  assert.ok(template);
  return template;
}

function firstSchedule(config: TenantOperationsConfig) {
  const schedule = config.schedules[0];
  assert.ok(schedule);
  return schedule;
}

function firstEscalation(config: TenantOperationsConfig) {
  const escalation = config.escalations[0];
  assert.ok(escalation);
  return escalation;
}

function withFirstStep(patch: Record<string, unknown>): unknown {
  const config = cloneConfig();
  const template = firstTemplate(config);
  const [step, ...remainingSteps] = template.steps;
  assert.ok(step);
  return {
    ...config,
    templates: [{ ...template, steps: [{ ...step, ...patch }, ...remainingSteps] }],
  };
}

function withFirstSchedule(patch: Record<string, unknown>): unknown {
  const config = cloneConfig();
  const [schedule, ...remainingSchedules] = config.schedules;
  assert.ok(schedule);
  return { ...config, schedules: [{ ...schedule, ...patch }, ...remainingSchedules] };
}

function withFirstEscalation(patch: Record<string, unknown>): unknown {
  const config = cloneConfig();
  const [escalation, ...remainingEscalations] = config.escalations;
  assert.ok(escalation);
  return { ...config, escalations: [{ ...escalation, ...patch }, ...remainingEscalations] };
}

function withRetention(patch: Record<string, unknown>): unknown {
  const config = cloneConfig();
  return { ...config, retention: { ...config.retention, ...patch } };
}

describe('tenant operations artifacts', () => {
  it('accepts an enabled tenant configuration', () => {
    const parsed = expectValid(VALID_CONFIG);
    assert.equal(parsed.templates[0]?.key, 'opening-routine');
    assert.equal(parsed.schedules[0]?.rule.kind, 'opening_offset');
  });

  it('accepts the Coffee Story operations artifact when enabled', () => {
    const parsed = expectValid(readArtifact('tenants/coffee-story/operations.json'));
    assert.equal(parsed.templates[0]?.programKey, 'guest-restroom');
    assert.equal(parsed.templates[0]?.revision, 1);
    assert.equal(parsed.templates.length, 3);
    assert.equal(parsed.schedules.length, 3);
  });

  it('accepts the industry-neutral template artifact whether disabled or enabled', () => {
    const artifact = readArtifact('tenants/_template/operations.json');
    for (const enabled of [false, true]) {
      const parsed = expectValid(artifact, enabled);
      assert.equal(parsed.templates.length, 0);
      assert.equal(parsed.schedules.length, 0);
    }
  });

  it('rejects operational definitions when the feature is disabled', () => {
    expectInvalid(VALID_CONFIG, /require features\.operations/, false);
  });
});

describe('operation key uniqueness', () => {
  const duplicateCases: readonly {
    name: string;
    expected: RegExp;
    mutate: (config: TenantOperationsConfig) => void;
  }[] = [
    {
      name: 'role keys',
      expected: /roles keys must be unique/,
      mutate: (config) => {
        const role = config.roles[0];
        assert.ok(role);
        config.roles.push({ ...role });
      },
    },
    {
      name: 'competency keys',
      expected: /competencies keys must be unique/,
      mutate: (config) => {
        const competency = config.competencies[0];
        assert.ok(competency);
        config.competencies.push({ ...competency });
      },
    },
    {
      name: 'template keys',
      expected: /templates keys must be unique/,
      mutate: (config) => config.templates.push(structuredClone(firstTemplate(config))),
    },
    {
      name: 'schedule keys',
      expected: /schedules keys must be unique/,
      mutate: (config) => config.schedules.push({ ...firstSchedule(config) }),
    },
    {
      name: 'step keys within a template',
      expected: /templates\[0\]\.steps keys must be unique/,
      mutate: (config) => {
        const template = firstTemplate(config);
        const step = template.steps[0];
        assert.ok(step);
        template.steps.push({ ...step });
      },
    },
  ];

  for (const duplicateCase of duplicateCases) {
    it(`rejects duplicate ${duplicateCase.name}`, () => {
      const config = cloneConfig();
      duplicateCase.mutate(config);
      expectInvalid(config, duplicateCase.expected);
    });
  }

  it('rejects duplicate keys in template reference and category lists', () => {
    for (const property of ['requiredRoleKeys', 'requiredCompetencyKeys', 'issueCategories'] as const) {
      const config = cloneConfig();
      const template = firstTemplate(config);
      const value = template[property][0];
      assert.ok(value);
      template[property].push(value);
      expectInvalid(config, new RegExp(`templates\\[0\\]\\.${property} must not contain duplicates`));
    }
  });
});

describe('operation references', () => {
  it('rejects unresolved role and competency references', () => {
    const roleConfig = cloneConfig();
    firstTemplate(roleConfig).requiredRoleKeys = ['missing-role'];
    expectInvalid(roleConfig, /Template opening-routine references unknown role missing-role/);

    const competencyConfig = cloneConfig();
    firstTemplate(competencyConfig).requiredCompetencyKeys = ['missing-competency'];
    expectInvalid(competencyConfig, /Template opening-routine references unknown competency missing-competency/);
  });

  it('rejects unresolved template and schedule references', () => {
    const templateConfig = cloneConfig();
    firstSchedule(templateConfig).templateKey = 'missing-template';
    expectInvalid(templateConfig, /Schedule weekday-opening references unknown template missing-template/);

    const scheduleConfig = cloneConfig();
    const escalation = scheduleConfig.escalations.find((item) => item.scheduleKey !== null);
    assert.ok(escalation);
    escalation.scheduleKey = 'missing-schedule';
    expectInvalid(scheduleConfig, /Escalation references unknown schedule missing-schedule/);
  });
});

describe('operation step responses', () => {
  it('preserves constraints only on their supported response kinds', () => {
    const numeric = expectValid(withFirstStep({
      responseKind: 'number',
      minimum: -20.5,
      maximum: 100.5,
    }));
    assert.deepEqual(firstTemplate(numeric).steps[0]?.constraints,
      { minimum: -20.5, maximum: 100.5 });

    const text = expectValid(withFirstStep({ responseKind: 'text', maxLength: 500 }));
    assert.deepEqual(firstTemplate(text).steps[0]?.constraints, { maxLength: 500 });
    assert.equal(firstTemplate(expectValid(VALID_CONFIG)).steps
      .find((step) => step.key === 'inspect')?.issueOnFailure, true);
  });

  const invalidCases: readonly [string, unknown, RegExp][] = [
    ['unsupported response kind', withFirstStep({ responseKind: 'photo' }), /responseKind is unsupported/],
    ['issue creation on confirmation', withFirstStep({ issueOnFailure: true }), /requires a pass_fail response/],
    ['numeric bounds on confirmation', withFirstStep({ minimum: 0 }), /apply only to number responses/],
    ['text length on confirmation', withFirstStep({ maxLength: 10 }), /applies only to text responses/],
    ['non-numeric minimum', withFirstStep({ responseKind: 'number', minimum: 'zero' }), /minimum must be a number/],
    ['inverted numeric bounds', withFirstStep({ responseKind: 'number', minimum: 10, maximum: 9 }), /must not exceed maximum/],
    ['zero text length', withFirstStep({ responseKind: 'text', maxLength: 0 }), /maxLength must be an integer from 1 through 10000/],
    ['non-boolean required flag', withFirstStep({ required: 'yes' }), /required must be true or false/],
  ];

  for (const [name, value, expected] of invalidCases) {
    it(`rejects ${name}`, () => expectInvalid(value, expected));
  }
});

describe('operation schedules', () => {
  it('accepts fixed, opening, closing, and interval rules', () => {
    expectValid(withFirstSchedule({
      rule: { kind: 'fixed_time', localTime: '00:00', weekdays: [1, 7] },
      activeFrom: '2028-02-29',
      activeUntil: '2028-02-29',
    }));
    expectValid(withFirstSchedule({
      rule: { kind: 'closing_offset', offsetMinutes: -15, weekdays: [1, 7] },
    }));
    expectValid(withFirstSchedule({
      rule: {
        kind: 'open_interval', intervalMinutes: 60, startOffsetMinutes: 60,
        endOffsetMinutes: -60, weekdays: [1, 2, 3, 4, 5, 6, 7],
      },
    }));
  });

  const invalidCases: readonly [string, Record<string, unknown>, RegExp][] = [
    ['unsupported kind', { rule: { kind: 'monthly', weekdays: [1] } }, /kind is unsupported/],
    ['empty weekdays', { rule: { kind: 'opening_offset', offsetMinutes: 0, weekdays: [] } }, /weekdays/],
    ['duplicate weekdays', { rule: { kind: 'opening_offset', offsetMinutes: 0, weekdays: [1, 1] } }, /weekdays/],
    ['weekday below the ISO range', { rule: { kind: 'opening_offset', offsetMinutes: 0, weekdays: [0] } }, /weekdays/],
    ['weekday above the ISO range', { rule: { kind: 'opening_offset', offsetMinutes: 0, weekdays: [8] } }, /weekdays/],
    ['non-integer weekday', { rule: { kind: 'opening_offset', offsetMinutes: 0, weekdays: [1, 2.5] } }, /weekdays/],
    ['non-array weekdays', { rule: { kind: 'opening_offset', offsetMinutes: 0, weekdays: 'weekdays' } }, /weekdays must be an array/],
    ['hour above the time range', { rule: { kind: 'fixed_time', localTime: '24:00', weekdays: [1] } }, /localTime/],
    ['minute above the time range', { rule: { kind: 'fixed_time', localTime: '09:60', weekdays: [1] } }, /localTime/],
    ['short interval', { rule: { kind: 'open_interval', intervalMinutes: 14, startOffsetMinutes: 0, endOffsetMinutes: 0, weekdays: [1] } }, /intervalMinutes/],
    ['invalid calendar date', { activeFrom: '2026-02-30' }, /activeFrom/],
    ['reversed active dates', { activeFrom: '2026-02-01', activeUntil: '2026-01-31' }, /activeUntil must be on or after activeFrom/],
    ['zero due window', { dueWindowMinutes: 0 }, /dueWindowMinutes must be an integer from 1 through 1440/],
    ['negative grace period', { graceMinutes: -1 }, /graceMinutes must be an integer from 0 through 1440/],
  ];

  for (const [name, patch, expected] of invalidCases) {
    it(`rejects ${name}`, () => expectInvalid(withFirstSchedule(patch), expected));
  }
});

describe('operation escalations', () => {
  it('allows the same order in a brand default and a schedule override', () => {
    expectValid(VALID_CONFIG);
  });

  it('rejects duplicate channels', () => {
    expectInvalid(withFirstEscalation({ channels: ['push', 'push'] }), /channels must not contain duplicates/);
  });

  it('rejects empty and unsupported channels', () => {
    expectInvalid(withFirstEscalation({ channels: [] }), /channels must use in_app or push/);
    expectInvalid(withFirstEscalation({ channels: ['webhook'] }), /channels must use in_app or push/);
  });

  it('rejects duplicate order within the same escalation scope', () => {
    const config = cloneConfig();
    const escalation = firstEscalation(config);
    config.escalations.push({ ...escalation, recipientRole: 'brand_owner' });
    expectInvalid(config, /Escalation order must be unique within each schedule or brand default/);
  });

  const invalidCases: readonly [string, Record<string, unknown>, RegExp][] = [
    ['unsupported recipient', { recipientRole: 'staff' }, /recipientRole is unsupported/],
    ['order below range', { order: 0 }, /order must be an integer from 1 through 20/],
    ['order above range', { order: 21 }, /order must be an integer from 1 through 20/],
    ['negative offset', { offsetMinutes: -1 }, /offsetMinutes must be an integer from 0 through 43200/],
    ['excessive offset', { offsetMinutes: 43_201 }, /offsetMinutes must be an integer from 0 through 43200/],
  ];

  for (const [name, patch, expected] of invalidCases) {
    it(`rejects ${name}`, () => expectInvalid(withFirstEscalation(patch), expected));
  }
});

describe('operations retention', () => {
  it('accepts inclusive retention boundaries', () => {
    expectValid(withRetention({ evidenceDays: 30, issueDays: 3650, actorIdentityDays: 30 }));
  });

  const invalidCases: readonly [string, Record<string, unknown>, RegExp][] = [
    ['evidence below minimum', { evidenceDays: 29 }, /retention\.evidenceDays/],
    ['issues above maximum', { issueDays: 3651 }, /retention\.issueDays/],
    ['non-integer actor identity period', { actorIdentityDays: 30.5 }, /retention\.actorIdentityDays/],
  ];

  for (const [name, patch, expected] of invalidCases) {
    it(`rejects ${name}`, () => expectInvalid(withRetention(patch), expected));
  }
});

describe('invalid operations JSON shapes', () => {
  const rootCases: readonly [string, unknown][] = [
    ['null', null],
    ['an array', []],
    ['text', 'operations'],
    ['a number', 42],
  ];

  for (const [name, value] of rootCases) {
    it(`rejects ${name} at the document root`, () => expectInvalid(value, /operations\.json must be an object/));
  }

  const fieldCases: readonly [string, unknown, RegExp][] = [
    ['null roles', { ...VALID_CONFIG, roles: null }, /roles must be an array/],
    ['object competencies', { ...VALID_CONFIG, competencies: {} }, /competencies must be an array/],
    ['null templates', { ...VALID_CONFIG, templates: null }, /templates must be an array/],
    ['object schedules', { ...VALID_CONFIG, schedules: {} }, /schedules must be an array/],
    ['text escalations', { ...VALID_CONFIG, escalations: 'later' }, /escalations must be an array/],
    ['null retention', { ...VALID_CONFIG, retention: null }, /retention must be an object/],
    ['primitive role', { ...VALID_CONFIG, roles: [false] }, /roles\[0\] must be an object/],
    ['primitive competency', { ...VALID_CONFIG, competencies: [7] }, /competencies\[0\] must be an object/],
    ['primitive template', { ...VALID_CONFIG, templates: ['template'] }, /templates\[0\] must be an object/],
    ['primitive schedule', { ...VALID_CONFIG, schedules: [true] }, /schedules\[0\] must be an object/],
    ['primitive escalation', { ...VALID_CONFIG, escalations: [1] }, /escalations\[0\] must be an object/],
    ['object steps', {
      ...VALID_CONFIG,
      templates: [{ ...firstTemplate(cloneConfig()), steps: {} }],
    }, /templates\[0\]\.steps must be an array/],
    ['mixed role reference list', {
      ...VALID_CONFIG,
      templates: [{ ...firstTemplate(cloneConfig()), requiredRoleKeys: ['floor-operations', 42] }],
    }, /requiredRoleKeys must contain only text values/],
    ['mixed weekday list', withFirstSchedule({
      rule: { kind: 'opening_offset', offsetMinutes: 0, weekdays: [1, '2'] },
    }), /weekdays/],
  ];

  for (const [name, value, expected] of fieldCases) {
    it(`rejects ${name}`, () => expectInvalid(value, expected));
  }
});
