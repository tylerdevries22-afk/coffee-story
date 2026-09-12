/**
 * One send surface over three channels -- Expo push, Twilio SMS, Resend
 * email -- with templates drawn from the brand's copy dictionary so every
 * message speaks the tenant's language (rule 4 for words).
 *
 * Transports are env-gated and injected for tests; a missing configuration
 * fails loudly at send time, never silently drops.
 */

import { randomUUID } from 'node:crypto';

import { fetchExternalWithRetry } from './http';
import { NotificationDeliveryUncertainError, requestNotification } from './notification-request';

export type NotificationChannel = 'push' | 'sms' | 'email';

export type BrandMessageContext = {
  appName: string;
  pointsName: string;
};

export const TEMPLATES = {
  order_ready: {
    title: '{appName}',
    // Mirrors `orderReadyMessage` in the UI copy dictionary. Deliberately
    // vertical-neutral: a shop that wants to say "while it's hot" writes that
    // in its own dictionary, and a tenant selling something that is not food
    // must never be sent a sentence about hot drinks.
    body: 'Order {shortCode} is ready for pickup.',
  },
  drop_live: {
    title: '{appName}',
    body: '{dropTitle} just dropped. It’s gone when it’s gone.',
  },
  points_earned: {
    title: '{appName}',
    body: 'You earned {points} {pointsName}. {pointsToNext} to your next reward.',
  },
  task_due: {
    title: '{appName}',
    body: '{taskTitle} is ready to claim at {locationName}.',
  },
  task_overdue: {
    title: '{appName}',
    body: '{taskTitle} is overdue at {locationName}.',
  },
  task_issue_reported: {
    title: '{appName}',
    body: 'An issue was reported for {taskTitle} at {locationName}.',
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

/**
 * Bodies a tenant has rewritten, keyed like TEMPLATES and carrying the same
 * `{placeholders}`.
 *
 * An argument rather than a dictionary lookup because packages/engine may not
 * depend on packages/ui: the caller already loads the brand row to build
 * `BrandMessageContext`, so it reads the matching copy keys off the same row
 * and passes them here. Anything absent falls back to the neutral default.
 */
export type BrandTemplateBodies = Partial<Record<TemplateKey, string>>;

export function renderTemplate(
  key: TemplateKey,
  context: BrandMessageContext & Record<string, string | number>,
  bodies: BrandTemplateBodies = {},
): { title: string; body: string } {
  const fill = (template: string) =>
    template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in context ? String(context[name as keyof typeof context]) : whole,
    );
  const template = TEMPLATES[key];
  return { title: fill(template.title), body: fill(bodies[key] ?? template.body) };
}

export type Transport = {
  sendPush: (
    token: string,
    title: string,
    body: string,
    data?: Readonly<Record<string, string>>,
  ) => Promise<void>;
  sendSms: (phone: string, body: string) => Promise<void>;
  sendEmail: (address: string, subject: string, body: string) => Promise<void>;
};

/** Expo returns provider rejections inside an otherwise successful HTTP response. */
export function expoPushAccepted(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const data = (payload as Record<string, unknown>).data;
  return Boolean(data && typeof data === 'object' && !Array.isArray(data)
    && (data as Record<string, unknown>).status === 'ok');
}

/** The real transports. Each throws with the missing env var named. */
export function liveTransport(env: NodeJS.ProcessEnv = process.env): Transport {
  return {
    async sendPush(token, title, body, data) {
      const response = await requestNotification('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: token, title, body, sound: 'default', ...(data ? { data } : {}) }),
      });
      if (!response.ok) throw new Error(`Expo push failed: ${response.status}`);
      const payload: unknown = await response.json().catch(() => null);
      if (expoPushAccepted(payload)) return;
      const ticket = payload && typeof payload === 'object' && 'data' in payload ? payload.data : null;
      if (ticket && typeof ticket === 'object' && 'status' in ticket && ticket.status === 'error') {
        throw new Error('Expo push was rejected.');
      }
      throw new NotificationDeliveryUncertainError();
    },
    async sendSms(phone, body) {
      const sid = env.TWILIO_ACCOUNT_SID;
      const auth = env.TWILIO_AUTH_TOKEN;
      const from = env.TWILIO_FROM_NUMBER;
      if (!sid || !auth || !from) throw new Error('Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.');
      const response = await requestNotification(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: phone, From: from, Body: body }),
      });
      if (!response.ok) throw new Error(`Twilio send failed: ${response.status}`);
    },
    async sendEmail(address, subject, body) {
      const key = env.RESEND_API_KEY;
      const from = env.RESEND_FROM;
      if (!key || !from) throw new Error('Set RESEND_API_KEY and RESEND_FROM.');
      const response = await fetchExternalWithRetry('https://api.resend.com/emails', {
        method: 'POST',
        // One key per send invocation; every internal transport retry reuses it.
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ from, to: address, subject, text: body }),
      });
      if (!response.ok) throw new Error(`Resend send failed: ${response.status}`);
    },
  };
}

export type Recipient = {
  channel: NotificationChannel;
  /** push token, phone, or email address, matching the channel. */
  address: string;
};

export async function sendNotification(
  transport: Transport,
  recipient: Recipient,
  key: TemplateKey,
  context: BrandMessageContext & Record<string, string | number>,
  pushData?: Readonly<Record<string, string>>,
  bodies?: BrandTemplateBodies,
): Promise<void> {
  const { title, body } = renderTemplate(key, context, bodies);
  switch (recipient.channel) {
    case 'push': return transport.sendPush(recipient.address, title, body, pushData);
    case 'sms': return transport.sendSms(recipient.address, body);
    case 'email': return transport.sendEmail(recipient.address, title, body);
  }
}

export type OperationPushWork = {
  outboxId: string;
  occurrenceId: string;
  tokens: readonly string[];
  appName: string;
  taskTitle: string;
  locationName: string;
};

export type OperationPushResult = {
  outboxId: string;
  outcome: 'sent' | 'failed' | 'uncertain';
  errorCode: 'no_active_device' | 'delivery_failed' | 'delivery_uncertain' | null;
};

/** Delivers one claimed batch without leaking provider errors into persisted audit data. */
export async function deliverOperationPushBatch(
  transport: Transport,
  work: readonly OperationPushWork[],
): Promise<OperationPushResult[]> {
  return Promise.all(work.map(async (item) => {
    if (item.tokens.length === 0) {
      return { outboxId: item.outboxId, outcome: 'failed', errorCode: 'no_active_device' } as const;
    }
    const deliveries = await Promise.allSettled(item.tokens.map((token) => sendNotification(
      transport,
      { channel: 'push', address: token },
      'task_overdue',
      { appName: item.appName, pointsName: '', taskTitle: item.taskTitle, locationName: item.locationName },
      { occurrenceId: item.occurrenceId },
    )));
    const uncertain = deliveries.some((delivery) => delivery.status === 'rejected'
      && delivery.reason instanceof NotificationDeliveryUncertainError);
    if (uncertain) return { outboxId: item.outboxId, outcome: 'uncertain', errorCode: 'delivery_uncertain' } as const;
    const delivered = deliveries.some((delivery) => delivery.status === 'fulfilled');
    return delivered
      ? { outboxId: item.outboxId, outcome: 'sent', errorCode: null } as const
      : { outboxId: item.outboxId, outcome: 'failed', errorCode: 'delivery_failed' } as const;
  }));
}
