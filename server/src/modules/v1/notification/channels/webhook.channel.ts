import { Injectable } from '@nestjs/common';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { Announcement, Delivered, NotificationChannelSender } from '../notification.types';

/**
 * The person's own webhook: one address for everything they are told, rather
 * than the per-alarm target an alarm rule carries in `delivery.custom`.
 *
 * The two are different things on purpose. An alarm's own webhook is a contract
 * with somebody's home automation - its payload is theirs, templated, and
 * unchanged since before any of this - while this one is a channel of the
 * routing grid and carries the same message every other channel carries. Which
 * is why the body is the notification and not a sensor reading.
 *
 * The target and the headers are secrets: they can name a host on the person's
 * own network and carry an authorisation header, which is why they are
 * serialised to their owner alone and never leave this server otherwise.
 */
@Injectable()
export class WebhookChannel implements NotificationChannelSender {
  public readonly name = 'webhook' as const;

  public async send(to: StoredUser, message: Announcement): Promise<Delivered | null> {
    const webhook = to.notifications.channels.webhook;
    if (!webhook?.url) return null;

    const payload = JSON.stringify({
      category: message.category,
      subject: message.subject,
      severity: message.severity,
      title: message.title,
      body: message.body,
      sentAt: new Date().toISOString(),
    });

    // A GET carries no body, and somebody who chose one wants the call itself
    // to be the signal - a doorbell on their own hardware.
    const carries = webhook.method !== 'GET';
    const response = await fetch(webhook.url, {
      method: webhook.method,
      headers: { ...(carries ? { 'content-type': 'application/json' } : {}), ...webhook.headers },
      body: carries ? payload : undefined,
    });

    // Whatever the host answers is theirs to decide; a refusal is worth knowing
    // about and is raised so the decision above records nothing.
    if (!response.ok) throw new Error(`The webhook answered ${response.status}`);

    return { externalMessageId: null };
  }
}
