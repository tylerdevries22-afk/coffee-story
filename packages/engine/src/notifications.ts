/**
 * One send surface over three channels -- Expo push, Twilio SMS, Resend
 * email -- with templates drawn from the brand's copy dictionary so every
 * message speaks the tenant's language (rule 4 for words).
 *
 * Transports are env-gated and injected for tests; a missing configuration
 * fails loudly at send time, never silently drops.
 */

import { fetchExternalWithRetry } from './http';

export type NotificationChannel = 'push' | 'sms' | 'email';

export type BrandMessageContext = {
  appName: string;
  pointsName: string;
};

export const TEMPLATES = {
  order_ready: {
    title: '{appName}',
    body: 'Order {shortCode} is ready — come and get it while it’s hot.',
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

export function renderTemplate(
  key: TemplateKey,
  context: BrandMessageContext & Record<string, string | number>,
): { title: string; body: string } {
  const fill = (template: string) =>
    template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in context ? String(context[name as keyof typeof context]) : whole,
    );
  const template = TEMPLATES[key];
  return { title: fill(template.title), body: fill(template.body) };
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
      const response = await fetchExternalWithRetry('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: token, title, body, sound: 'default', ...(data ? { data } : {}) }),
      });
      if (!response.ok) throw new Error(`Expo push failed: ${response.status}`);
      const payload: unknown = await response.json().catch(() => null);
      if (!expoPushAccepted(payload)) throw new Error('Expo push was rejected.');
    },
    async sendSms(phone, body) {
      const sid = env.TWILIO_ACCOUNT_SID;
      const auth = env.TWILIO_AUTH_TOKEN;
      const from = env.TWILIO_FROM_NUMBER;
      if (!sid || !auth || !from) throw new Error('Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.');
      const response = await fetchExternalWithRetry(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
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
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
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
): Promise<void> {
  const { title, body } = renderTemplate(key, context);
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
  outcome: 'sent' | 'failed';
  errorCode: 'no_active_device' | 'delivery_failed' | null;
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
    const delivered = deliveries.some((delivery) => delivery.status === 'fulfilled');
    return delivered
      ? { outboxId: item.outboxId, outcome: 'sent', errorCode: null } as const
      : { outboxId: item.outboxId, outcome: 'failed', errorCode: 'delivery_failed' } as const;
  }));
}
