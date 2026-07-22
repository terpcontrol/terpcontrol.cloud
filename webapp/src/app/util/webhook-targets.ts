export type WebhookTargetId = 'discord' | 'telegram' | 'ntfy' | 'home_assistant' | 'custom';

export interface WebhookTargetField {
  key: string;
  labelKey: string;
  placeholder?: string;
  type?: 'text' | 'password' | 'url';
  required?: boolean;
  defaultValue?: string;
}

export interface WebhookTargetDef {
  id: WebhookTargetId;
  icon: string;
  fields: WebhookTargetField[];
  /**
   * Whether tunneling the webhook through the device makes sense: public
   * services ('none') are always reachable directly, while LAN endpoints like
   * Home Assistant default to the tunnel ('default_on'). 'optional' leaves
   * the choice open (custom URLs).
   */
  tunnel: 'none' | 'optional' | 'default_on';
  /**
   * Writes actionTarget/method/payloads (and tunnelWebhook where sensible)
   * onto the alarm. Payload texts contain {{placeholders}} the server
   * substitutes at send time; the surrounding wording is translated once at
   * creation and stored verbatim with the alarm.
   */
  apply?: (alarm: Record<string, any>, values: Record<string, string>, translate: (key: string) => string) => void;
  /** Display-only recognition of an existing alarm's target type. */
  matches?: (actionTarget: string) => boolean;
}

const discordPayload = (emoji: string, eventText: string): string =>
  JSON.stringify({ content: `${emoji} ${eventText}: {{alarmName}} — {{sensorType}} {{value}} ({{deviceName}})` });

const telegramPayload = (chatId: string, emoji: string, eventText: string): string =>
  JSON.stringify({ chat_id: chatId, text: `${emoji} ${eventText}: {{alarmName}} — {{sensorType}} {{value}} ({{deviceName}})` });

const ntfyPayload = (topic: string, emoji: string, eventText: string, priority: number): string =>
  JSON.stringify({
    topic,
    title: `${emoji} ${eventText}: {{alarmName}} ({{deviceName}})`,
    message: '{{sensorType}} = {{value}}',
    priority,
  });

export const WEBHOOK_TARGETS: WebhookTargetDef[] = [
  {
    id: 'discord',
    icon: 'logo-discord',
    tunnel: 'none',
    fields: [
      {
        key: 'webhookUrl',
        labelKey: 'webhookTargets.discord.url',
        placeholder: 'https://discord.com/api/webhooks/…',
        type: 'url',
        required: true,
      },
    ],
    apply: (alarm, values, translate) => {
      alarm['actionTarget'] = (values['webhookUrl'] ?? '').trim();
      alarm['webhookMethod'] = 'POST';
      alarm['webhookTriggeredPayload'] = discordPayload('🚨', translate('webhookTargets.msgTriggered'));
      alarm['webhookResolvedPayload'] = discordPayload('✅', translate('webhookTargets.msgResolved'));
      alarm['tunnelWebhook'] = false;
    },
    matches: target => target.includes('discord.com/api/webhooks') || target.includes('discordapp.com/api/webhooks'),
  },
  {
    id: 'telegram',
    icon: 'paper-plane-outline',
    tunnel: 'none',
    fields: [
      { key: 'botToken', labelKey: 'webhookTargets.telegram.botToken', placeholder: '123456:ABC-DEF…', type: 'password', required: true },
      { key: 'chatId', labelKey: 'webhookTargets.telegram.chatId', placeholder: '-1001234567890', required: true },
    ],
    apply: (alarm, values, translate) => {
      alarm['actionTarget'] = `https://api.telegram.org/bot${(values['botToken'] ?? '').trim()}/sendMessage`;
      alarm['webhookMethod'] = 'POST';
      alarm['webhookTriggeredPayload'] = telegramPayload((values['chatId'] ?? '').trim(), '🚨', translate('webhookTargets.msgTriggered'));
      alarm['webhookResolvedPayload'] = telegramPayload((values['chatId'] ?? '').trim(), '✅', translate('webhookTargets.msgResolved'));
      alarm['tunnelWebhook'] = false;
    },
    matches: target => target.includes('api.telegram.org/bot'),
  },
  {
    id: 'ntfy',
    icon: 'notifications-outline',
    tunnel: 'none',
    fields: [
      { key: 'topic', labelKey: 'webhookTargets.ntfy.topic', placeholder: 'mein-grow-alarm', required: true },
      { key: 'server', labelKey: 'webhookTargets.ntfy.server', defaultValue: 'https://ntfy.sh', type: 'url' },
    ],
    apply: (alarm, values, translate) => {
      // ntfy's JSON publish endpoint is the server root — ideal here because
      // the alarm webhook always sends Content-Type: application/json.
      alarm['actionTarget'] = ((values['server'] ?? '').trim() || 'https://ntfy.sh').replace(/\/+$/, '');
      alarm['webhookMethod'] = 'POST';
      alarm['webhookTriggeredPayload'] = ntfyPayload((values['topic'] ?? '').trim(), '🚨', translate('webhookTargets.msgTriggered'), 4);
      alarm['webhookResolvedPayload'] = ntfyPayload((values['topic'] ?? '').trim(), '✅', translate('webhookTargets.msgResolved'), 3);
      alarm['tunnelWebhook'] = false;
    },
    matches: target => target.includes('ntfy'),
  },
  {
    id: 'home_assistant',
    icon: 'home-outline',
    tunnel: 'default_on',
    fields: [
      { key: 'baseUrl', labelKey: 'webhookTargets.home_assistant.baseUrl', placeholder: 'http://homeassistant.local:8123', type: 'url', required: true },
      { key: 'webhookId', labelKey: 'webhookTargets.home_assistant.webhookId', required: true },
    ],
    apply: (alarm, values) => {
      const base = (values['baseUrl'] ?? '').trim().replace(/\/+$/, '');
      alarm['actionTarget'] = `${base}/api/webhook/${(values['webhookId'] ?? '').trim()}`;
      alarm['webhookMethod'] = 'POST';
      // The default JSON payload carries all values — ideal for HA templates.
      alarm['webhookTriggeredPayload'] = '';
      alarm['webhookResolvedPayload'] = '';
      // HA instances usually live on the LAN, reachable through the device tunnel.
      alarm['tunnelWebhook'] = !/^https:\/\//.test(base) || /\.local|192\.168\.|10\.|127\./.test(base);
    },
    matches: target => target.includes('/api/webhook/'),
  },
  {
    id: 'custom',
    icon: 'code-working-outline',
    tunnel: 'optional',
    fields: [],
  },
];

export function getWebhookTarget(id: WebhookTargetId): WebhookTargetDef | undefined {
  return WEBHOOK_TARGETS.find(target => target.id === id);
}

/** Guesses which target an existing alarm was built for (display only). */
export function detectWebhookTarget(actionTarget: string | undefined): WebhookTargetId {
  if (!actionTarget) {
    return 'custom';
  }
  const url = actionTarget.split('|')[0].trim();
  return WEBHOOK_TARGETS.find(target => target.matches?.(url))?.id ?? 'custom';
}
