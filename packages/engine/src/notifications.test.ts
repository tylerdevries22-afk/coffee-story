import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deliverOperationPushBatch,
  expoPushAccepted,
  renderTemplate,
  sendNotification,
  type Transport,
} from './notifications';

const CONTEXT = { appName: 'Coffee Story', pointsName: 'Beans' };

describe('renderTemplate', () => {
  it('speaks the brand dictionary', () => {
    const message = renderTemplate('points_earned', { ...CONTEXT, points: 46, pointsToNext: 54 });
    assert.equal(message.title, 'Coffee Story');
    assert.equal(message.body, 'You earned 46 Beans. 54 to your next reward.');
  });

  it('leaves an unknown placeholder visible rather than blank', () => {
    const message = renderTemplate('order_ready', { ...CONTEXT });
    assert.ok(message.body.includes('{shortCode}'));
  });
});

describe('sendNotification', () => {
  it('accepts only an Expo success ticket', () => {
    assert.equal(expoPushAccepted({ data: { status: 'ok', id: 'ticket' } }), true);
    assert.equal(expoPushAccepted({ data: { status: 'error', message: 'DeviceNotRegistered' } }), false);
    assert.equal(expoPushAccepted({}), false);
  });

  it('routes each channel to its transport', async () => {
    const calls: string[] = [];
    const transport: Transport = {
      sendPush: async (token, title) => { calls.push(`push:${token}:${title}`); },
      sendSms: async (phone) => { calls.push(`sms:${phone}`); },
      sendEmail: async (address, subject) => { calls.push(`email:${address}:${subject}`); },
    };
    await sendNotification(transport, { channel: 'push', address: 'ExpoT[1]' }, 'drop_live', { ...CONTEXT, dropTitle: 'X' });
    await sendNotification(transport, { channel: 'sms', address: '+17205550100' }, 'drop_live', { ...CONTEXT, dropTitle: 'X' });
    await sendNotification(transport, { channel: 'email', address: 'a@b.c' }, 'drop_live', { ...CONTEXT, dropTitle: 'X' });
    assert.deepEqual(calls, ['push:ExpoT[1]:Coffee Story', 'sms:+17205550100', 'email:a@b.c:Coffee Story']);
  });

  it('delivers bounded operation push work and returns safe retry codes', async () => {
    const calls: string[] = [];
    const transport: Transport = {
      sendPush: async (token, _title, _body, data) => {
        calls.push(`${token}:${data?.occurrenceId ?? 'missing'}`);
        if (token === 'bad-token') throw new Error('provider secret detail');
      },
      sendSms: async () => undefined,
      sendEmail: async () => undefined,
    };
    const results = await deliverOperationPushBatch(transport, [
      { outboxId: 'sent', occurrenceId: 'occurrence-sent', tokens: ['good-token'], appName: 'Coffee Story',
        taskTitle: 'Safety walk', locationName: 'Downtown' },
      { outboxId: 'failed', occurrenceId: 'occurrence-failed', tokens: ['bad-token'], appName: 'Coffee Story',
        taskTitle: 'Closing check', locationName: 'Downtown' },
      { outboxId: 'partial', occurrenceId: 'occurrence-partial', tokens: ['bad-token', 'good-token'], appName: 'Coffee Story',
        taskTitle: 'Midday check', locationName: 'Downtown' },
      { outboxId: 'unpaired', occurrenceId: 'occurrence-unpaired', tokens: [], appName: 'Coffee Story',
        taskTitle: 'Opening check', locationName: 'Downtown' },
    ]);
    assert.deepEqual(calls, [
      'good-token:occurrence-sent',
      'bad-token:occurrence-failed',
      'bad-token:occurrence-partial',
      'good-token:occurrence-partial',
    ]);
    assert.deepEqual(results, [
      { outboxId: 'sent', outcome: 'sent', errorCode: null },
      { outboxId: 'failed', outcome: 'failed', errorCode: 'delivery_failed' },
      { outboxId: 'partial', outcome: 'sent', errorCode: null },
      { outboxId: 'unpaired', outcome: 'failed', errorCode: 'no_active_device' },
    ]);
  });
});
