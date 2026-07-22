import {Component, EventEmitter, Input, OnDestroy, OnInit, Output} from "@angular/core";
import {TranslateService} from "@ngx-translate/core";
import {detectWebhookTarget, getWebhookTarget, WEBHOOK_TARGETS, WebhookTargetId} from "src/app/util/webhook-targets";

@Component({
  selector: 'alarms',
  templateUrl: './alarms.component.html',
  styleUrls: ['./alarms.component.scss'],
})
export class AlarmsComponent {
  @Input() availableSensorTypes: string[] = [];
  @Input() alarms: any;
  @Input() cloud_settings:any = {};
  @Input() deviceType = '';
  @Input() hasCo2 = true;
  /** Current grow stage; makes preset thresholds stage-aware. */
  @Input() stage: any = null;
  @Output() alarmsChange = new EventEmitter<any>();

  public presetModalOpen = false;
  public webhookTargets = WEBHOOK_TARGETS;

  constructor(private translate: TranslateService) {}

  onPresetCreated(alarm: Record<string, any>) {
    this.alarmsChange.emit([alarm, ...(this.alarms || [])]);
  }

  addAlarm() {
    const newAlarm = {
      sensorType: this.availableSensorTypes[0], // Default to the first sensor type
      upperThreshold: null,
      lowerThreshold: null,
      actionType: 'info', // Default action type
      actionTarget: '',
      cooldownSeconds: 600,
      retriggerSeconds: 3600,
      name: 'My Alarm',
      additionalInfo: true,
    };
    this.alarmsChange.emit([newAlarm, ...(this.alarms || [])]);
  }

  /**
   * Guided webhook targets: a per-alarm transient draft (stripped by the
   * server schema, like newHeaderName) writes through to the raw fields, so
   * the form below always shows exactly what will be sent.
   */
  webhookTargetType(alarm: any): WebhookTargetId {
    return alarm._webhookTargetType ?? detectWebhookTarget(alarm.actionTarget);
  }

  setWebhookTargetType(alarm: any, type: WebhookTargetId) {
    alarm._webhookTargetType = type;
    alarm._targetDraft = alarm._targetDraft ?? {};
    getWebhookTarget(type)?.fields.forEach(field => {
      if (field.defaultValue && !alarm._targetDraft[field.key]) {
        alarm._targetDraft[field.key] = field.defaultValue;
      }
    });
    this.applyWebhookTarget(alarm);
  }

  applyWebhookTarget(alarm: any) {
    const def = getWebhookTarget(this.webhookTargetType(alarm));
    if (!def?.apply) {
      return;
    }
    const values = alarm._targetDraft ?? {};
    if (def.fields.some(field => field.required && !(values[field.key] ?? '').trim())) {
      return;
    }
    def.apply(alarm, values, key => this.translate.instant(key));
    this.alarmsChange.emit(this.alarms);
  }

  webhookTargetFields(alarm: any) {
    return getWebhookTarget(this.webhookTargetType(alarm))?.fields ?? [];
  }

  ensureTargetDraft(alarm: any): Record<string, string> {
    alarm._targetDraft = alarm._targetDraft ?? {};
    return alarm._targetDraft;
  }

  removeAlarm(alarm: any) {
    const index = this.alarms.indexOf(alarm);
    if (index > -1) {
      this.alarms.splice(index, 1);
    }
    this.alarmsChange.emit(this.alarms);
  }

  toggleAlarm(alarm: any) {
    alarm.disabled = !alarm.disabled;
    this.alarmsChange.emit(this.alarms);
  }

  addWebhookHeader(alarm: any) {
    alarm.webhookHeaders[alarm.newHeaderName.trim()] = '';
    alarm.newHeaderName = '';
    this.alarmsChange.emit(this.alarms);
  }

  deleteWebhookHeader(alarm: any, headerName: any) {
    delete alarm.webhookHeaders[headerName];
    this.alarmsChange.emit(this.alarms);
  }

  trackByMethod(alarm: any) {
    return (index: number, el: any): number => el.key + alarm.disabled;
  }

  castToString(obj: any): string{
    return obj as string;
  }
}
