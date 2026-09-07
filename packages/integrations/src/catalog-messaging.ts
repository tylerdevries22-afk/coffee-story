import { apiKeySetup, logo, oauthSetup, type CatalogDefinition } from './catalog-definition';

/** Google and the outbound messaging providers. */
export const MESSAGING_DEFINITIONS: readonly CatalogDefinition[] = [
  {
    id: 'google-suite', provider: 'Google', displayName: 'Google', category: 'marketing',
    availability: 'provider-approval-required', authentication: 'oauth2',
    summary: 'Business Profile, Gmail, Drive, Calendar, Analytics, and Ads.',
    capabilities: ['business-profile.performance', 'business-profile.reviews', 'business-profile.locations', 'gmail.send-reviewed', 'drive.import', 'drive.export', 'calendar.read', 'calendar.write', 'ga4.reporting', 'google-ads.reporting'],
    mapping: ['organization', 'account', 'location'],
    health: ['auth', 'read', 'write', 'quota', 'reconciliation'],
    logo: logo('google', '#4285F4', 'retain-official-mark'), webhooks: true,
    setup: oauthSetup({
      id: 'google-suite', estimatedMinutes: 2,
      consoleUrl: 'https://console.cloud.google.com/apis/credentials',
      documentationUrl: 'https://developers.google.com/identity/protocols/oauth2/web-server',
      credentialEnvKeys: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
      operatorSteps: [
        { text: 'Grant the Business Profile locations you manage, not every location Google offers.' },
      ],
    }),
  },
  {
    id: 'slack', provider: 'Slack', displayName: 'Slack', category: 'communications',
    availability: 'available', authentication: 'oauth2',
    summary: 'Selected-channel alerts, daily summaries, tests, and revocation.',
    capabilities: ['channels.read', 'alerts.write', 'summaries.write'],
    mapping: ['organization', 'account', 'location'],
    health: ['auth', 'read', 'write', 'webhook', 'quota'],
    logo: logo('slack', '#4A154B', 'retain-official-mark'), webhooks: true,
    setup: oauthSetup({
      id: 'slack',
      consoleUrl: 'https://api.slack.com/apps',
      documentationUrl: 'https://api.slack.com/authentication/oauth-v2',
      credentialEnvKeys: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
      operatorSteps: [
        { text: 'Pick the single channel that should receive alerts; you can change it later.' },
      ],
    }),
  },
  {
    id: 'twilio', provider: 'Twilio', displayName: 'Twilio', category: 'communications',
    availability: 'available', authentication: 'api-key-reference',
    summary: 'Verified SMS senders, delivery status, quotas, and webhook reconciliation.',
    capabilities: ['sms.send', 'senders.read', 'delivery.read'],
    mapping: ['organization', 'account'],
    health: ['auth', 'read', 'write', 'webhook', 'quota', 'reconciliation'],
    logo: logo('twilio', '#F22F46'), webhooks: true,
    setup: apiKeySetup({
      estimatedMinutes: 4,
      consoleUrl: 'https://console.twilio.com/us1/account/keys-credentials/api-keys',
      documentationUrl: 'https://www.twilio.com/docs/messaging',
      credentialEnvKeys: ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET'],
      steps: [
        { text: 'Open Twilio Console, then Account, then API keys and tokens.', href: 'https://console.twilio.com/us1/account/keys-credentials/api-keys' },
        { text: 'Create a standard API key and copy the SID and secret before closing the dialog.' },
        { text: 'Paste the key, its secret, and your Account SID into this connector.' },
      ],
    }),
  },
  {
    id: 'resend', provider: 'Resend', displayName: 'Resend', category: 'communications',
    availability: 'available', authentication: 'api-key-reference',
    summary: 'Transactional email, sender health, delivery events, and suppressions.',
    capabilities: ['email.send', 'domains.read', 'delivery.read', 'suppressions.read'],
    mapping: ['organization', 'account'],
    health: ['auth', 'read', 'write', 'webhook', 'quota'],
    logo: logo('resend', '#000000'), webhooks: true,
    setup: apiKeySetup({
      estimatedMinutes: 3,
      consoleUrl: 'https://resend.com/api-keys',
      documentationUrl: 'https://resend.com/docs/api-reference/introduction',
      credentialEnvKeys: ['RESEND_API_KEY'],
      steps: [
        { text: 'Open Resend, then API Keys, then Create API Key.', href: 'https://resend.com/api-keys' },
        { text: 'Give it Sending access, then copy the key that starts with re_.' },
        { text: 'Verify the sending domain you plan to use.', href: 'https://resend.com/domains' },
      ],
    }),
  },
  {
    id: 'sendgrid', provider: 'Twilio SendGrid', displayName: 'SendGrid',
    category: 'communications', availability: 'available', authentication: 'api-key-reference',
    summary: 'Transactional email, verified senders, delivery events, and suppression health.',
    capabilities: ['email.send', 'senders.read', 'delivery.read', 'suppressions.read'],
    mapping: ['organization', 'account'],
    health: ['auth', 'read', 'write', 'webhook', 'quota', 'reconciliation'],
    logo: logo('sendgrid', '#1A82E2'), webhooks: true,
    setup: apiKeySetup({
      estimatedMinutes: 3,
      consoleUrl: 'https://app.sendgrid.com/settings/api_keys',
      documentationUrl: 'https://www.twilio.com/docs/sendgrid/api-reference',
      credentialEnvKeys: ['SENDGRID_API_KEY'],
      steps: [
        { text: 'Open SendGrid, then Settings, then API Keys, then Create API Key.', href: 'https://app.sendgrid.com/settings/api_keys' },
        { text: 'Choose Restricted Access with Mail Send, then copy the key once.' },
        { text: 'Complete sender authentication for your domain.', href: 'https://app.sendgrid.com/settings/sender_auth' },
      ],
    }),
  },
] as const;
