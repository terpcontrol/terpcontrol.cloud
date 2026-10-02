import { describe, expect, it } from 'vitest';
import { isComplete, isLocalAddress, templateOf, WEBHOOK_TEMPLATES } from '@/screens/control/alarms/webhook-templates';

/**
 * The four ready-made webhooks: what each one fills in, and that a rule built
 * from one is recognised again and opened with its answers.
 */

const t = (key: string) => ({ 'webhookTargets.msgTriggered': 'Alarm', 'webhookTargets.msgResolved': 'Wieder ok' })[key] ?? key;
const template = (id: string) => WEBHOOK_TEMPLATES.find(one => one.id === id)!;

describe('a webhook template', () => {
  it('sends Home Assistant the standard message, and calls an address at home through the device', () => {
    const local = template('home_assistant').fill({ baseUrl: 'http://192.168.1.20:8123/', webhookId: 'tc' }, t);
    const cloud = template('home_assistant').fill({ baseUrl: 'https://my.nabu.casa', webhookId: 'tc' }, t);

    expect(local).toMatchObject({ url: 'http://192.168.1.20:8123/api/webhook/tc', method: 'POST', triggeredPayload: '', tunnel: true });
    expect(cloud.tunnel).toBe(false);
  });

  it('builds the Telegram call from the bot token and the chat, in the reader’s words', () => {
    const filled = template('telegram').fill({ botToken: '123:ABC', chatId: '-100' }, t);

    expect(filled.url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(JSON.parse(filled.triggeredPayload)).toEqual({
      chat_id: '-100',
      text: '🚨 Alarm: {{alarmName}} · {{sensorType}} {{value}} ({{deviceName}})',
    });
    expect(JSON.parse(filled.resolvedPayload).text).toMatch(/^✅ Wieder ok:/);
  });

  it('publishes to ntfy.sh unless another server is named, with the topic in the body', () => {
    const filled = template('ntfy').fill({ topic: 'my-grow', server: '' }, t);

    expect(filled.url).toBe('https://ntfy.sh');
    expect(JSON.parse(filled.triggeredPayload)).toMatchObject({ topic: 'my-grow', priority: 4 });
    expect(isComplete(template('ntfy'), { topic: 'my-grow' })).toBe(true);
    expect(isComplete(template('ntfy'), { topic: ' ' })).toBe(false);
  });

  it.each([
    ['home_assistant', { baseUrl: 'http://ha.local:8123', webhookId: 'abc' }],
    ['discord', { webhookUrl: 'https://discord.com/api/webhooks/1/x' }],
    ['telegram', { botToken: '9:Z', chatId: '42' }],
    ['ntfy', { topic: 'grow', server: 'https://ntfy.example.org' }],
  ])('recognises a %s rule and reads its answers back', (id, values) => {
    const filled = template(id).fill(values, t);

    expect(templateOf(filled)?.id).toBe(id);
    expect(templateOf(filled)?.read(filled)).toEqual(values);
  });

  it('recognises nothing in a webhook of somebody’s own', () => {
    expect(templateOf({ url: 'https://example.org/hook', triggeredPayload: '' })).toBeNull();
  });

  it.each([
    ['http://example.org', true],
    ['https://homeassistant.local', true],
    ['https://10.0.0.5', true],
    ['https://172.20.1.1', true],
    ['https://nas', true],
    ['https://example.org', false],
    ['https://172.40.1.1', false],
    ['not a url', false],
  ])('takes %s to be at home: %s', (address, local) => {
    expect(isLocalAddress(address)).toBe(local);
  });
});
