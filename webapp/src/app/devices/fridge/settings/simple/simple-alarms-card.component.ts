import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/**
 * Novice-friendly notifications list. Creation goes through the shared
 * <alarm-add-modal> (also used by the expert alarms section); this card only
 * lists, toggles and removes. Edits the same alarms array the expert form
 * uses; persisted via Save.
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

  constructor(private translate: TranslateService) {}

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

  onCreated(alarm: Record<string, any>) {
    this.alarms.unshift(alarm);
    this.alarmsChange.emit(this.alarms);
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
