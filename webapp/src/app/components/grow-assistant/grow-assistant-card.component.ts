import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { DataService } from 'src/app/services/data.service';
import { deviceControlCapability } from 'src/app/util/grow-presets';
import { KeyedCache } from 'src/app/util/keyed-cache';

const TEMPERATURE_TOLERANCE = 1.5;
const HUMIDITY_TOLERANCE = 7;
const TIPS_PER_STAGE = 4;

type AssistantStage = 'seedling' | 'vegetative' | 'flowering' | 'drying';

interface RangeDeviation {
  measure: 'temperature' | 'humidity';
  direction: 'above' | 'below';
  current: number;
  targetValue: number;
}

/**
 * Compact grow-assistant strip for the device overview card: current plan
 * stage with day counter, a live check of measured values against the active
 * targets, stage tips, and a link to the matching chart view. Works for
 * controlling and monitoring-only devices alike — for the latter the range
 * check is the product.
 */
@Component({
  selector: 'grow-assistant-card',
  templateUrl: './grow-assistant-card.component.html',
  styleUrls: ['./grow-assistant-card.component.scss'],
})
export class GrowAssistantCardComponent implements OnInit, OnDestroy {
  @Input() device_id = '';
  @Input() deviceType = '';
  @Input() recipe: any = null;
  @Input() settings: any = null;
  @Input() cloudSettings: any = null;
  @Input() hardwareInfo: Record<string, string> | undefined;
  @Input() isDay = false;
  @Output() startPlan = new EventEmitter<void>();

  public currentTemperature = NaN;
  public currentHumidity = NaN;
  public dismissed = false;
  public tipIndexes = Array.from({ length: TIPS_PER_STAGE }, (_, i) => i + 1);

  private subscriptions: Subscription[] = [];

  constructor(private data: DataService) {}

  ngOnInit() {
    this.dismissed = localStorage.getItem(this.dismissKey) === 'true';
    this.subscriptions.push(
      this.data.measure(this.device_id, 'temperature').subscribe(value => (this.currentTemperature = value)),
      this.data.measure(this.device_id, 'humidity').subscribe(value => (this.currentHumidity = value)),
    );
  }

  ngOnDestroy() {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  private get dismissKey(): string {
    return `assistant-dismissed-${this.device_id}`;
  }

  dismiss() {
    this.dismissed = true;
    localStorage.setItem(this.dismissKey, 'true');
  }

  get isReference(): boolean {
    const capability = deviceControlCapability({ device_type: this.deviceType, hardwareInfo: this.hardwareInfo });
    return capability === 'monitor' || capability === 'light_only';
  }

  get planRunning(): boolean {
    return this.recipe?.activeSince > 0;
  }

  get activeStep(): any {
    return this.planRunning ? this.recipe?.steps?.[this.recipe.activeStepIndex] : null;
  }

  get stage(): AssistantStage | null {
    const stepStage = this.activeStep?.stage;
    if (stepStage === 'seedling' || stepStage === 'vegetative' || stepStage === 'flowering' || stepStage === 'drying') {
      return stepStage;
    }
    if (this.settings?.workmode === 'dry') {
      return 'drying';
    }
    return null;
  }

  get stageLabelKey(): string {
    switch (this.stage) {
      case 'seedling': return 'growPresets.stages.seedling';
      case 'vegetative': return 'growPresets.stages.vegetative';
      case 'flowering': return 'growPresets.stages.flowering';
      case 'drying': return 'growPresets.stages.drying';
      default: return 'simpleSettings.plan.title';
    }
  }

  get stageIcon(): string {
    switch (this.stage) {
      case 'seedling': return 'assets/icon/presets/seedling.svg';
      case 'vegetative': return 'assets/icon/presets/vegetation.svg';
      case 'flowering': return 'assets/icon/presets/flower.svg';
      case 'drying': return 'assets/icon/presets/drying.svg';
      default: return 'assets/icon/presets/custom.svg';
    }
  }

  private stepDurationMs(step: any): number {
    const unitMinutes = step?.durationUnit === 'weeks' ? 7 * 24 * 60 : step?.durationUnit === 'days' ? 24 * 60 : step?.durationUnit === 'hours' ? 60 : 1;
    return (Number(step?.duration) || 0) * unitMinutes * 60 * 1000;
  }

  get dayInStage(): number {
    return this.planRunning ? Math.floor((Date.now() - this.recipe.activeSince) / 86400000) + 1 : 0;
  }

  get stageDurationDays(): number {
    return Math.max(1, Math.round(this.stepDurationMs(this.activeStep) / 86400000));
  }

  get stageProgress(): number {
    const duration = this.stepDurationMs(this.activeStep);
    if (!this.planRunning || duration <= 0) {
      return 0;
    }
    // Quantized so the binding only changes when the bar visibly moves —
    // a raw Date.now() ratio dirtied the DOM on every change detection.
    return Math.min(1, Math.round(((Date.now() - this.recipe.activeSince) / duration) * 1000) / 1000);
  }

  get waitingForConfirmation(): boolean {
    return this.planRunning
      && !!this.activeStep?.waitForConfirmation
      && Date.now() - this.recipe.activeSince >= this.stepDurationMs(this.activeStep);
  }

  get nextStepName(): string | null {
    return this.planRunning ? this.recipe?.steps?.[this.recipe.activeStepIndex + 1]?.name ?? null : null;
  }

  /** The currently applicable targets, following the day/night state. */
  private get activeTargets(): { temperature: number; humidity: number } | null {
    const workmode = this.settings?.workmode;
    if (!workmode || workmode === 'off' || workmode === 'breed') {
      return null;
    }
    const hasDaycycle = ['exp', 'full', 'small', 'temp'].includes(workmode);
    const source = hasDaycycle && this.isDay ? this.settings?.day : this.settings?.night;
    const temperature = Number(source?.temperature);
    const humidity = Number(source?.humidity);
    if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) {
      return null;
    }
    return { temperature, humidity };
  }

  get rangeAvailable(): boolean {
    return this.activeTargets !== null && Number.isFinite(this.currentTemperature) && Number.isFinite(this.currentHumidity);
  }

  // Memoized: change detection runs these getters constantly, and returning
  // fresh arrays/objects each time made ngFor/routerLink rework the DOM on
  // every pass.
  private deviationsCache = new KeyedCache<RangeDeviation[]>();

  get deviations(): RangeDeviation[] {
    const targets = this.activeTargets;
    if (!targets || !this.rangeAvailable) {
      return this.deviationsCache.get('none', () => []);
    }

    const key = [this.currentTemperature, this.currentHumidity, targets.temperature, targets.humidity, this.settings?.workmode].join('|');
    return this.deviationsCache.get(key, () => this.buildDeviations(targets));
  }

  private buildDeviations(targets: { temperature: number; humidity: number }): RangeDeviation[] {
    const result: RangeDeviation[] = [];
    if (Math.abs(this.currentTemperature - targets.temperature) > TEMPERATURE_TOLERANCE) {
      result.push({
        measure: 'temperature',
        direction: this.currentTemperature > targets.temperature ? 'above' : 'below',
        current: Math.round(this.currentTemperature * 10) / 10,
        targetValue: targets.temperature,
      });
    }
    const humidityRelevant = ['exp', 'full', 'small', 'dry'].includes(this.settings?.workmode);
    if (humidityRelevant && Math.abs(this.currentHumidity - targets.humidity) > HUMIDITY_TOLERANCE) {
      result.push({
        measure: 'humidity',
        direction: this.currentHumidity > targets.humidity ? 'above' : 'below',
        current: Math.round(this.currentHumidity),
        targetValue: targets.humidity,
      });
    }
    return result;
  }

  private static readonly DRYING_CHART_PARAMS = { measures: 'temperature,humidity', timespan: '2w' };
  private static readonly DEFAULT_CHART_PARAMS = { measures: 'temperature,humidity,vpd', timespan: '1d' };

  get chartQueryParams(): Record<string, string> {
    return this.stage === 'drying'
      ? GrowAssistantCardComponent.DRYING_CHART_PARAMS
      : GrowAssistantCardComponent.DEFAULT_CHART_PARAMS;
  }

  get showTips(): boolean {
    return this.stage !== null;
  }

  get showBanner(): boolean {
    return !this.planRunning && !this.dismissed;
  }
}
