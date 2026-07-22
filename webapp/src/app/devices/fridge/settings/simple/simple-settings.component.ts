import { Component, EventEmitter, Input, Output } from '@angular/core';
import { calculateVpd } from 'src/app/util/calculateVpd';
import {
  applyStagePreset,
  detectActiveStagePreset,
  deviceControlCapability,
  deviceHasCo2,
  GrowStagePresetId,
} from 'src/app/util/grow-presets';

/**
 * Novice-friendly settings for fridge/controller devices: grow-stage presets
 * plus only the essential targets, each explained in plain language. Works on
 * the same configuration object as the expert form — while a grow plan runs it
 * edits the active step's settings so saving keeps the plan alive.
 */
@Component({
  selector: 'fridge-simple-settings',
  templateUrl: './simple-settings.component.html',
  styleUrls: ['./simple-settings.component.scss'],
})
export class FridgeSimpleSettingsComponent {
  @Input() deviceSettings: any = {};
  @Output() deviceSettingsChange = new EventEmitter<any>();
  @Input() recipe: any = null;
  @Input() cloudSettings: any = {};
  @Input() deviceType = '';
  @Input() hardwareInfo: Record<string, string> | undefined;
  @Output() stopPlanRequested = new EventEmitter<void>();
  @Output() confirmStepRequested = new EventEmitter<void>();
  @Output() startPlanRequested = new EventEmitter<void>();

  public lightDurations = [12, 14, 16, 18, 20];
  public baseLightStartOptions = Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, '0')}:00`);

  public limits = {
    temperature: { min: 5, max: 40 },
    humidity: { min: 10, max: 90 },
    co2: { min: 100, max: 2000 },
  };

  private offset = new Date().getTimezoneOffset() * 60;

  get planRunning(): boolean {
    return this.recipe?.activeSince > 0;
  }

  get activeStep(): any {
    return this.planRunning ? this.recipe?.steps?.[this.recipe.activeStepIndex] : null;
  }

  /** The settings object simple mode edits: the running plan step's, else the device's. */
  get target(): any {
    return this.activeStep?.settings ?? this.deviceSettings;
  }

  /** Derived from the paired sockets — not a setting (see deviceControlCapability). */
  get controlCapability(): string {
    return deviceControlCapability({ device_type: this.deviceType, hardwareInfo: this.hardwareInfo });
  }

  /** Targets are reference values when the controller doesn't actuate the climate. */
  get isReference(): boolean {
    return this.controlCapability === 'monitor' || this.controlCapability === 'light_only';
  }

  get isMonitor(): boolean {
    return this.controlCapability === 'monitor';
  }

  get activePreset(): GrowStagePresetId | 'custom' | null {
    return detectActiveStagePreset(this.target);
  }

  get workmode(): string {
    return this.target?.workmode ?? 'off';
  }

  get hasDaycycle(): boolean {
    return ['exp', 'full', 'small', 'temp'].includes(this.workmode);
  }

  get hasHumidity(): boolean {
    return ['exp', 'full', 'small', 'dry'].includes(this.workmode);
  }

  get hasCo2(): boolean {
    return (
      ['exp', 'full', 'small', 'temp'].includes(this.workmode) &&
      deviceHasCo2({ device_type: this.deviceType, hardwareInfo: this.hardwareInfo })
    );
  }

  get isOff(): boolean {
    return this.workmode === 'off';
  }

  get floatingDayActive(): boolean {
    return !!this.target?.daynight?.floating;
  }

  /** Upcoming plan steps stay editable in simple mode (durations only). */
  public editingDurationIndex: number | null = null;
  // Memoized so change detection sees stable row objects (a fresh array of
  // wrappers per cycle would make ngFor rebuild the DOM continuously).
  private upcomingCache: { key: string; value: { step: any; index: number }[] } = { key: '', value: [] };

  get upcomingSteps(): { step: any; index: number }[] {
    if (!this.planRunning || !Array.isArray(this.recipe?.steps)) {
      return [];
    }
    const key = `${this.recipe.activeStepIndex}|${this.recipe.steps.length}|${this.recipe.activeSince}`;
    if (this.upcomingCache.key !== key) {
      this.upcomingCache = {
        key,
        value: this.recipe.steps
          .map((step: any, index: number) => ({ step, index }))
          .slice((this.recipe.activeStepIndex ?? 0) + 1),
      };
    }
    return this.upcomingCache.value;
  }

  trackByStepIndex(_position: number, item: { index: number }): number {
    return item.index;
  }

  toggleDurationEdit(index: number) {
    this.editingDurationIndex = this.editingDurationIndex === index ? null : index;
  }

  adjustStepDuration(step: any, delta: number) {
    step.duration = Math.min(99, Math.max(1, Math.round((Number(step.duration) || 1) + delta)));
  }

  private durationToMs(step: any): number {
    const value = Number(step?.duration) || 0;
    switch (step?.durationUnit) {
      case 'minutes':
        return value * 60_000;
      case 'hours':
        return value * 3_600_000;
      case 'weeks':
        return value * 7 * 86_400_000;
      default:
        return value * 86_400_000;
    }
  }

  /** Estimated start of an upcoming step (confirmation waits can delay it). */
  stepStartEta(index: number): number {
    let eta = Number(this.recipe?.activeSince) || Date.now();
    for (let i = this.recipe.activeStepIndex ?? 0; i < index; i++) {
      eta += this.durationToMs(this.recipe.steps[i]);
    }
    return eta;
  }

  stageIconFor(step: any): string | null {
    if (!step?.stage) {
      return null;
    }
    const name = step.stage === 'vegetative' ? 'vegetation' : step.stage === 'flowering' ? 'flower' : step.stage;
    return 'assets/icon/presets/' + name + '.svg';
  }

  selectPreset(id: GrowStagePresetId | 'custom') {
    if (id === 'custom') {
      return;
    }

    // CO2 enrichment follows the hardware, same as the setup wizard.
    const hasCo2 = deviceHasCo2({ device_type: this.deviceType, hardwareInfo: this.hardwareInfo });
    const updated = applyStagePreset(this.target, id, { hasCo2 });

    if (this.activeStep) {
      this.activeStep.settings = updated;
    } else {
      this.deviceSettings = updated;
      this.deviceSettingsChange.emit(updated);
    }
  }

  private emitIfManual() {
    if (!this.activeStep) {
      this.deviceSettingsChange.emit(this.deviceSettings);
    }
  }

  setValue(section: 'day' | 'night' | 'co2' | 'lights', key: string, value: any) {
    if (!this.target) {
      return;
    }
    this.target[section] = this.target[section] ?? {};
    this.target[section][key] = value;
    this.emitIfManual();
  }

  /** Local wall-clock "HH:mm" of the stored (UTC-seconds-of-day) daybreak. */
  get lightStart(): string {
    const stored = Number(this.target?.daynight?.day ?? 21600);
    let local = stored - this.offset;
    if (local < 0) local += 86400;
    if (local >= 86400) local -= 86400;
    const hours = Math.floor(local / 3600);
    const minutes = Math.floor((local % 3600) / 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  get lightStartOptions(): string[] {
    const current = this.lightStart;
    return this.baseLightStartOptions.includes(current)
      ? this.baseLightStartOptions
      : [...this.baseLightStartOptions, current].sort();
  }

  onLightStartChange(value: string | null | undefined) {
    const match = /(\d{2}):(\d{2})/.exec(value ?? '');
    if (!match || !this.target) {
      return;
    }

    const hoursOfLight = this.lightHours;
    let stored = Number(match[1]) * 3600 + Number(match[2]) * 60 + this.offset;
    if (stored < 0) stored += 86400;
    if (stored >= 86400) stored -= 86400;

    this.target.daynight = this.target.daynight ?? {};
    this.target.daynight.day = stored;
    this.target.daynight.night = (stored + hoursOfLight * 3600) % 86400;
    this.emitIfManual();
  }

  get lightHours(): number {
    const day = Number(this.target?.daynight?.day ?? 21600);
    const night = Number(this.target?.daynight?.night ?? 79200);
    return Math.round(((night - day + 86400) % 86400) / 360) / 10;
  }

  onLightHoursChange(hours: number) {
    if (!this.target) {
      return;
    }
    const day = Number(this.target?.daynight?.day ?? 21600);
    this.target.daynight = this.target.daynight ?? {};
    this.target.daynight.night = (day + Number(hours) * 3600) % 86400;
    this.emitIfManual();
  }

  getDayVpd(): number {
    return calculateVpd(
      this.target?.day?.temperature,
      this.target?.day?.temperature + (this.cloudSettings?.vpdLeafTempOffsetDay ?? -2),
      this.target?.day?.humidity,
    );
  }

  getNightVpd(): number {
    return calculateVpd(
      this.target?.night?.temperature,
      this.target?.night?.temperature + (this.cloudSettings?.vpdLeafTempOffsetNight ?? 0),
      this.target?.night?.humidity,
    );
  }

  get stageTitleKey(): string | null {
    return this.stageLabelKey(this.activeStep?.stage);
  }

  stageLabelKey(stage: string | undefined): string | null {
    switch (stage) {
      case 'seedling': return 'growPresets.stages.seedling';
      case 'vegetative': return 'growPresets.stages.vegetative';
      case 'flowering': return 'growPresets.stages.flowering';
      case 'drying': return 'growPresets.stages.drying';
      default: return null;
    }
  }

  private stepDurationMs(step: any): number {
    const unitMinutes = step?.durationUnit === 'weeks' ? 7 * 24 * 60 : step?.durationUnit === 'days' ? 24 * 60 : step?.durationUnit === 'hours' ? 60 : 1;
    return (Number(step?.duration) || 0) * unitMinutes * 60 * 1000;
  }

  get dayInStage(): number {
    if (!this.planRunning) {
      return 0;
    }
    return Math.floor((Date.now() - this.recipe.activeSince) / 86400000) + 1;
  }

  get stageDurationDays(): number {
    return Math.max(1, Math.round(this.stepDurationMs(this.activeStep) / 86400000));
  }

  get stageProgress(): number {
    const duration = this.stepDurationMs(this.activeStep);
    if (!this.planRunning || duration <= 0) {
      return 0;
    }
    return Math.min(1, (Date.now() - this.recipe.activeSince) / duration);
  }

  get waitingForConfirmation(): boolean {
    return this.planRunning
      && !!this.activeStep?.waitForConfirmation
      && Date.now() - this.recipe.activeSince >= this.stepDurationMs(this.activeStep);
  }

  get nextStep(): any {
    return this.planRunning ? this.recipe?.steps?.[this.recipe.activeStepIndex + 1] : null;
  }
}
