import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from 'src/app/auth/auth.service';
import { AlarmPresetDef, availableAlarmPresets, buildAlarmFromPreset, presetNameKey } from 'src/app/util/alarm-presets';
import { getWebhookTarget, WebhookTargetField, WebhookTargetId } from 'src/app/util/webhook-targets';

type ChannelId = 'info' | 'email' | Exclude<WebhookTargetId, 'custom'>;

/**
 * Two-step guided alarm creation (preset → notification channel), shared by
 * the simple-mode notifications card and the expert alarms section. Emits the
 * finished alarm object; persisting stays with the caller's Save flow.
 */
@Component({
  selector: 'alarm-add-modal',
  templateUrl: './alarm-add-modal.component.html',
  styleUrls: ['./alarm-add-modal.component.scss'],
})
export class AlarmAddModalComponent {
  @Input() isOpen = false;
  @Input() deviceType = '';
  @Input() hasCo2 = true;
  /** Current grow stage; makes preset thresholds stage-aware. */
  @Input() stage: any = null;
  @Input() availableSensorTypes: string[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<Record<string, any>>();

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
    const presets = availableAlarmPresets({ hasCo2: this.hasCo2 });
    if (this.availableSensorTypes.length === 0) {
      return presets;
    }
    return presets.filter(preset => this.availableSensorTypes.includes(preset.sensorType));
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

  onWillPresent() {
    this.addStep = 'preset';
    this.selectedPreset = null;
    this.channel = 'info';
    this.email = this.auth.current_user.getValue()?.username ?? '';
    this.targetValues = {};
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

    this.created.emit(alarm);
    this.closed.emit();
  }
}
