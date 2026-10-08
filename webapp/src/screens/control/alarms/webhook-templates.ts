import type { Translate } from '@/i18n/i18n';
import type { RuleDraft } from './rules';

/**
 * Ready-made webhooks for the services growers point their alarms at: the
 * fields a service asks for in, a finished URL, method and messages out.
 *
 * A template only fills in the webhook fields of the sheet - what is saved is
 * still a plain webhook - so a rule built from one can be changed by hand
 * afterwards, and one built by hand is recognised as the template it matches
 * and opened with its fields filled in.
 *
 * The messages use the placeholders the server fills in at send time; the
 * words around them are put in the reader's language once, when the template
 * is applied, and stored with the rule as they are.
 */

type WebhookTemplateId = 'home_assistant' | 'discord' | 'telegram' | 'ntfy';

interface TemplateField {
  key: string;
  /** The catalogue key of its label. */
  label: string;
  placeholder?: string;
  secret?: boolean;
  /** What it starts as, for a field with an answer most people keep. */
  initial?: string;
  optional?: boolean;
}

export type TemplateValues = Record<string, string>;

type Filled = Pick<RuleDraft, 'url' | 'method' | 'headers' | 'triggeredPayload' | 'resolvedPayload' | 'tunnel'>;

export interface WebhookTemplate {
  id: WebhookTemplateId;
  fields: TemplateField[];
  fill: (values: TemplateValues, t: Translate) => Filled;
  /** The fields again, read out of a rule built from this template; null where the rule is not one. */
  read: (draft: Pick<RuleDraft, 'url' | 'triggeredPayload'>) => TemplateValues | null;
}

/**
 * What a person reads in a chat. `{{sensorType}}` is left out of it: it is the
 * machine's word for what is watched ("temperature"), kept as it always was for
 * the home automations that read it, and it stood English in the middle of a
 * German sentence. The rule's own name already says what it watches.
 */
const message = (emoji: string, event: string) => `${emoji} ${event}: {{alarmName}} · {{value}} ({{deviceName}})`;

const jsonOf = (payload: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const trimmed = (value: string | undefined): string => (value ?? '').trim();

/**
 * Whether the cloud cannot reach an address and the device in the tent can: an
 * address on the local network, or one served without TLS, which a home
 * assistant on the internet never is. Such a call goes through the device.
 */
export const isLocalAddress = (address: string): boolean => {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  const host = url.hostname;

  return (
    url.protocol !== 'https:' ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    !host.includes('.') ||
    /^(10|127)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
};

export const WEBHOOK_TEMPLATES: WebhookTemplate[] = [
  {
    id: 'home_assistant',
    fields: [
      { key: 'baseUrl', label: 'webhookTargets.home_assistant.baseUrl', placeholder: 'http://homeassistant.local:8123' },
      { key: 'webhookId', label: 'webhookTargets.home_assistant.webhookId', placeholder: 'terp-control-alarm' },
    ],
    fill: values => {
      const base = trimmed(values.baseUrl).replace(/\/+$/, '');
      // The standard message carries every value, which is what an
      // automation's template reads; so both messages are left empty.
      return {
        url: `${base}/api/webhook/${trimmed(values.webhookId)}`,
        method: 'POST',
        headers: '',
        triggeredPayload: '',
        resolvedPayload: '',
        tunnel: isLocalAddress(base),
      };
    },
    read: draft => {
      const [base, id] = draft.url.split('/api/webhook/');
      return id === undefined ? null : { baseUrl: base, webhookId: id };
    },
  },
  {
    id: 'discord',
    fields: [{ key: 'webhookUrl', label: 'webhookTargets.discord.url', placeholder: 'https://discord.com/api/webhooks/…' }],
    fill: (values, t) => ({
      url: trimmed(values.webhookUrl),
      method: 'POST',
      headers: '',
      triggeredPayload: JSON.stringify({ content: message('🚨', t('webhookTargets.msgTriggered')) }),
      resolvedPayload: JSON.stringify({ content: message('✅', t('webhookTargets.msgResolved')) }),
      tunnel: false,
    }),
    read: draft => (/discord(app)?\.com\/api\/webhooks/.test(draft.url) ? { webhookUrl: draft.url } : null),
  },
  {
    id: 'telegram',
    fields: [
      { key: 'botToken', label: 'webhookTargets.telegram.botToken', placeholder: '123456:ABC-DEF…', secret: true },
      { key: 'chatId', label: 'webhookTargets.telegram.chatId', placeholder: '-1001234567890' },
    ],
    fill: (values, t) => {
      const chat = trimmed(values.chatId);
      return {
        url: `https://api.telegram.org/bot${trimmed(values.botToken)}/sendMessage`,
        method: 'POST',
        headers: '',
        triggeredPayload: JSON.stringify({ chat_id: chat, text: message('🚨', t('webhookTargets.msgTriggered')) }),
        resolvedPayload: JSON.stringify({ chat_id: chat, text: message('✅', t('webhookTargets.msgResolved')) }),
        tunnel: false,
      };
    },
    read: draft => {
      const token = /api\.telegram\.org\/bot([^/]+)\//.exec(draft.url)?.[1];
      return token === undefined ? null : { botToken: token, chatId: String(jsonOf(draft.triggeredPayload).chat_id ?? '') };
    },
  },
  {
    id: 'ntfy',
    fields: [
      { key: 'topic', label: 'webhookTargets.ntfy.topic', placeholder: 'mein-grow-alarm' },
      { key: 'server', label: 'webhookTargets.ntfy.server', initial: 'https://ntfy.sh', optional: true },
    ],
    // ntfy takes a JSON publish at the root of the server, which suits a
    // webhook that always sends JSON; the topic travels in the body.
    fill: (values, t) => {
      const topic = trimmed(values.topic);
      const title = (emoji: string, event: string) => `${emoji} ${event}: {{alarmName}} ({{deviceName}})`;
      return {
        url: (trimmed(values.server) || 'https://ntfy.sh').replace(/\/+$/, ''),
        method: 'POST',
        headers: '',
        triggeredPayload: JSON.stringify({
          topic,
          title: title('🚨', t('webhookTargets.msgTriggered')),
          message: `${t('webhookTargets.msgValue')} {{value}}`,
          priority: 4,
        }),
        resolvedPayload: JSON.stringify({
          topic,
          title: title('✅', t('webhookTargets.msgResolved')),
          message: `${t('webhookTargets.msgValue')} {{value}}`,
          priority: 3,
        }),
        tunnel: false,
      };
    },
    read: draft => {
      const topic = jsonOf(draft.triggeredPayload).topic;
      return draft.url.includes('ntfy') && typeof topic === 'string' ? { server: draft.url, topic } : null;
    },
  },
];

/** The template a rule was built from, where it matches one. */
export const templateOf = (draft: Pick<RuleDraft, 'url' | 'triggeredPayload'>): WebhookTemplate | null =>
  WEBHOOK_TEMPLATES.find(template => template.read(draft) !== null) ?? null;

/** Whether everything a template needs has been answered. */
export const isComplete = (template: WebhookTemplate, values: TemplateValues): boolean =>
  template.fields.every(field => field.optional || trimmed(values[field.key]) !== '');
