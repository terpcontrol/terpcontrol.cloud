import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { Model } from 'mongoose';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { logIfItFails } from '@common/background-work';
import { logger } from '@utils/logger';
import { applyWebhookTemplate } from '@utils/webhookTemplate';
import { MailService } from '../mail/mail.service';
import { TunnelService } from '../tunnel/tunnel.service';
import { ALARM_ROUTING, AlarmEvent, AlarmRouting } from './alarm.types';

/**
 * Where an alarm is said out loud.
 *
 * A rule either addresses itself - the e-mail address or the webhook it was
 * written with, templates, headers and tunnel included - or it leaves the
 * question to the person's notification settings. The first is this file, kept
 * as it has always worked because the webhooks it calls are somebody's home
 * automation and their payloads are a contract with it. The second is handed to
 * the notifications part.
 *
 * An alert the health loop raised has no rule and is therefore always routed.
 */

/** Two targets in one field: what to tell when it triggers, and what to tell when it is over. */
const TARGET_SEPARATOR = '|';

@Injectable()
export class AlarmDeliveryService {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    private readonly entries: EntryWriterService,
    private readonly mail: MailService,
    private readonly tunnel: TunnelService,
    @Optional() @Inject(ALARM_ROUTING) private readonly routing: AlarmRouting | null = null,
  ) {}

  /**
   * A rule that is silenced sends nothing. The alert is still opened and still
   * written to the diary: a silence says "do not tell me", not "do not watch".
   */
  public async deliver(event: AlarmEvent, alert: StoredAlert, rule: StoredAlarmRule | null, name: string, value: number | null): Promise<void> {
    if (rule && rule.silencedUntil && rule.silencedUntil.getTime() > Date.now()) return;

    const custom = rule?.delivery.mode === 'custom' ? rule.delivery.custom : null;
    if (!custom) {
      await this.route(event, alert, rule);
      return;
    }

    try {
      if (custom.channel === 'email') await this.sendMail(event, alert, rule, custom, name, value);
      else await this.callWebhook(event, alert, rule, custom, name, value);
    } catch (error) {
      logger.error(`Failed to deliver the alarm ${name} for device ${alert.deviceId}: ${error}`);
    }
  }

  private async route(event: AlarmEvent, alert: StoredAlert, rule: StoredAlarmRule | null): Promise<void> {
    if (!this.routing) return;

    try {
      await this.routing.deliver(event, alert, rule);
    } catch (error) {
      logger.error(`Failed to route the alert ${alert.id}: ${error}`);
    }
  }

  private async sendMail(
    event: AlarmEvent,
    alert: StoredAlert,
    rule: StoredAlarmRule | null,
    custom: NonNullable<StoredAlarmRule['delivery']['custom']>,
    name: string,
    value: number | null,
  ): Promise<void> {
    const subject = `[TERP CONTROL] Alarm ${name} ${event} for Device ${alert.deviceId}`;
    const details =
      `Sensor: ${rule?.metric ?? alert.kind}\n` +
      (hasThresholds(rule)
        ? `Threshold: ${rule?.upper !== null ? `Upper: ${rule?.upper}` : ''} ${rule?.lower !== null ? `Lower: ${rule?.lower}` : ''}\n`
        : '') +
      `Value: ${value}\n` +
      `Alarm Name: ${name}\n` +
      `Alarm ID: ${alert.ruleId ?? alert.id}\n` +
      (event === 'resolved' && hasThresholds(rule) ? `Extreme Value: ${alert.extremeValue}\n` : '');

    const text = `An alarm has been ${event} for device ${alert.deviceId}.\n\n` + (custom.includeDetails ? details : '');
    const target = targetFor(custom.target, event);
    await this.mail.send({ to: target, subject, text });

    logger.info(`Alarm email sent to ${target} for device ${alert.deviceId} and ${rule?.metric ?? alert.kind}.`);
  }

  private async callWebhook(
    event: AlarmEvent,
    alert: StoredAlert,
    rule: StoredAlarmRule | null,
    custom: NonNullable<StoredAlarmRule['delivery']['custom']>,
    name: string,
    value: number | null,
  ): Promise<void> {
    let target = targetFor(custom.target, event);
    if (!target) {
      logger.error(`No webhook URL provided for the alarm ${name} on device ${alert.deviceId}`);
      return;
    }

    const webhook = custom.webhook;
    // The keys are what somebody's home automation reads, so they are the ones
    // the cloud has always sent even where the model now names the field otherwise.
    const defaultPayload = JSON.stringify({
      deviceId: alert.deviceId,
      sensorType: rule?.metric ?? alert.kind,
      value,
      upperThreshold: hasThresholds(rule) ? (rule?.upper ?? undefined) : undefined,
      lowerThreshold: hasThresholds(rule) ? (rule?.lower ?? undefined) : undefined,
      timestamp: new Date().toISOString(),
      event,
      alarmName: name,
      alarmId: alert.ruleId ?? alert.id,
      lastTriggeredAt: alert.startedAt.getTime(),
      extremeValue: event === 'resolved' && hasThresholds(rule) ? (alert.extremeValue ?? undefined) : undefined,
    });

    const template = event === 'triggered' ? webhook?.triggeredPayload : webhook?.resolvedPayload;
    let payload = template || defaultPayload;

    // {{placeholder}} templating applies only to user-authored payloads and
    // the target URL; the default payload is already structured JSON.
    if (template?.includes('{{') || target.includes('{{')) {
      const device = alert.deviceId ? await this.devices.findOne({ id: alert.deviceId }, { name: 1 }).lean() : null;
      const variables: Record<string, unknown> = {
        deviceId: alert.deviceId,
        deviceName: device?.name || alert.deviceId,
        sensorType: rule?.metric ?? alert.kind,
        value,
        upperThreshold: hasThresholds(rule) ? (rule?.upper ?? undefined) : undefined,
        lowerThreshold: hasThresholds(rule) ? (rule?.lower ?? undefined) : undefined,
        event,
        timestamp: new Date().toISOString(),
        alarmName: name,
        alarmId: alert.ruleId ?? alert.id,
        extremeValue: event === 'resolved' && hasThresholds(rule) ? (alert.extremeValue ?? undefined) : undefined,
      };
      if (template) payload = applyWebhookTemplate(template, variables, 'json');
      target = applyWebhookTemplate(target, variables, 'url');
    }

    const originalUrl = new URL(target);
    const targetUrl =
      webhook?.tunnel && alert.deviceId ? new URL(await this.tunnel.createTunnelProxyServer(originalUrl, alert.deviceId)) : originalUrl;
    const isHttps = originalUrl.protocol?.startsWith('https');
    const send = isHttps ? httpsRequest : httpRequest;

    const call = send(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: webhook?.method ?? 'POST',
        headers: {
          Host: originalUrl.host,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(webhook?.headers ?? {}),
        },
      },
      response => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          logger.info(`Webhook triggered successfully for device ${alert.deviceId} and alarm ${name}.`);
        } else {
          logger.error(`Failed to trigger webhook for device ${alert.deviceId} and alarm ${name}. Status: ${response.statusCode}`);
        }
      },
    );

    call.on('error', error => {
      const message = error.message || String(error) || 'Unknown error';
      logger.error(`Failed to trigger webhook for device ${alert.deviceId} and alarm ${name}: ${message}`);
      if (webhook?.reportErrors) logIfItFails(`Recording the webhook error for device ${alert.deviceId}`, this.reportError(alert, name, message));
    });

    call.write(payload);
    call.end();
  }

  private reportError(alert: StoredAlert, name: string, message: string): Promise<unknown> {
    return this.entries.write({
      source: 'alarm',
      authorId: null,
      values: { kind: 'alarm' },
      deviceId: alert.deviceId,
      spaceId: alert.spaceId,
      alertId: alert.id,
      severity: 'warning',
      message: { key: 'message-alarm-webhook-error', params: [`${name} - ${message}`] },
    });
  }
}

/** A rule watching something with no band around it - the health metrics - reports no thresholds. */
const hasThresholds = (rule: StoredAlarmRule | null): boolean => !!rule && (rule.upper !== null || rule.lower !== null);

/** One target for the trigger and another for the all-clear, as a single field with a separator. */
const targetFor = (target: string, event: AlarmEvent): string => {
  if (target.indexOf(TARGET_SEPARATOR) >= 0) return target.split(TARGET_SEPARATOR)[event === 'triggered' ? 0 : 1].trim();
  return target.trim();
};
