import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from 'src/app/auth/auth.service';
import { AlarmPresetDef, availableAlarmPresets, buildAlarmFromPreset, presetNameKey } from 'src/app/util/alarm-presets';
import { getWebhookTarget, WebhookTargetField, WebhookTargetId } from 'src/app/util/webhook-targets';

type ChannelId = 'info' | 'email' | Exclude<WebhookTargetId, 'custom'>;

/**
 * Novice-friendly notifications: pick a ready-made alarm, pick where it
 * should notify (log/email/Discord/Telegram/ntfy/Home Assistant), done.
 * Edits the same alarms array the expert form uses; persisted via Save.
 */
@Component({
  selector: 'simple-alarms-card',
  templateUrl: './simple-alarms-card.component.html',
  styleUrls: ['./simple-alarms-card.component.scss'],
})
export class SimpleAlarmsCardComponent {
  @Input() alarms: any[] = [];
  @Input() deviceType = '';
  @Input() hasCo2 = true;
  @Input() stage: any = null;
  @Output() alarmsChange = new EventEmitter<any>();

  public addOpen = false;
  public addStep: 'preset' | 'channel' = 'preset';
  public selectedPreset: AlarmPresetDef | null = null;
  public channel: ChannelId = 'info';
  public email = '';
  public targetValues: Record<string, string> = {};

  public channels: ChannelId[] = ['info', 'email', 'discord', 'telegram', 'ntfy', 'home_assistant'];

  constructor(
    private translate: TranslateService,
    private auth: AuthService,
  ) {}

  get presets(): AlarmPresetDef[] {
    return availableAlarmPresets({ hasCo2: this.hasCo2 });
  }

  presetName(def: AlarmPresetDef): string {
    return presetNameKey(def, this.deviceType);
  }

  get webhookFields(): WebhookTargetField[] {
    if (this.channel === 'info' || this.channel === 'email') {
      return [];
    }
    return getWebhookTarget(this.channel)?.fields ?? [];
  }

  channelIcon(channel: ChannelId): string {
    if (channel === 'info') {
      return 'document-text-outline';
    }
    if (channel === 'email') {
      return 'mail-outline';
    }
    return getWebhookTarget(channel)?.icon ?? 'notifications-outline';
  }

  /** One-line description of what the alarm watches. */
  summary(alarm: any): string {
    const unit = alarm.sensorType === 'temperature' ? '°C' : alarm.sensorType === 'co2' ? ' ppm' : '%';
    const minutes = alarm.thresholdSeconds ? Math.round(alarm.thresholdSeconds / 60) : 0;

    if (alarm.sensorType === 'dehumidifier' || alarm.sensorType === 'co2_valve') {
      return this.translate.instant('simpleSettings.notifications.runsFor', { minutes });
    }

    const parts: string[] = [];
    if (alarm.upperThreshold !== null && alarm.upperThreshold !== undefined) {
      parts.push(`> ${alarm.upperThreshold}${unit}`);
    }
    if (alarm.lowerThreshold !== null && alarm.lowerThreshold !== undefined) {
      parts.push(`< ${alarm.lowerThreshold}${unit}`);
    }
    let text = parts.join(' / ');
    if (minutes > 0) {
      text += ' · ' + this.translate.instant('simpleSettings.notifications.forMinutes', { minutes });
    }
    return text;
  }

  channelLabel(alarm: any): string {
    if (alarm.actionType === 'email') {
      return this.translate.instant('simpleSettings.notifications.channels.email');
    }
    if (alarm.actionType === 'webhook') {
      return this.translate.instant('simpleSettings.notifications.channels.webhook');
    }
    return this.translate.instant('simpleSettings.notifications.channels.info');
  }

  openAdd() {
    this.addStep = 'preset';
    this.selectedPreset = null;
    this.channel = 'info';
    this.email = this.auth.current_user.getValue()?.username ?? '';
    this.targetValues = {};
    this.addOpen = true;
  }

  pickPreset(def: AlarmPresetDef) {
    this.selectedPreset = def;
    this.addStep = 'channel';
  }

  pickChannel(channel: ChannelId) {
    this.channel = channel;
    this.targetValues = {};
    this.webhookFields.forEach(field => {
      if (field.defaultValue) {
        this.targetValues[field.key] = field.defaultValue;
      }
    });
  }

  canCreate(): boolean {
    if (!this.selectedPreset) {
      return false;
    }
    if (this.channel === 'email') {
      return this.email.trim().includes('@');
    }
    if (this.channel !== 'info') {
      return !this.webhookFields.some(field => field.required && !(this.targetValues[field.key] ?? '').trim());
    }
    return true;
  }

  create() {
    if (!this.selectedPreset || !this.canCreate()) {
      return;
    }

    const alarm = buildAlarmFromPreset(this.selectedPreset, {
      stage: this.stage,
      deviceType: this.deviceType,
      translate: key => this.translate.instant(key),
    });

    if (this.channel === 'email') {
      alarm['actionType'] = 'email';
      alarm['actionTarget'] = this.email.trim();
    } else if (this.channel !== 'info') {
      const target = getWebhookTarget(this.channel);
      alarm['actionType'] = 'webhook';
      target?.apply?.(alarm, this.targetValues, key => this.translate.instant(key));
    }

    this.alarms.unshift(alarm);
    this.alarmsChange.emit(this.alarms);
    this.addOpen = false;
  }

  toggle(alarm: any) {
    alarm.disabled = !alarm.disabled;
    this.alarmsChange.emit(this.alarms);
  }

  remove(alarm: any) {
    const index = this.alarms.indexOf(alarm);
    if (index > -1) {
      this.alarms.splice(index, 1);
      this.alarmsChange.emit(this.alarms);
    }
  }

  trackByIndex(index: number): number {
    return index;
  }
}
