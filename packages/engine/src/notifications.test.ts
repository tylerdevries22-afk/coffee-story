import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderTemplate, sendNotification, type Transport } from './notifications';

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
});
