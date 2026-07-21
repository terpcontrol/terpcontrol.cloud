import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ControlProfile } from '@fg2/shared-types';
import { AuthService } from 'src/app/auth/auth.service';
import { DataService } from 'src/app/services/data.service';
import { DeviceService, DeviceWithParsedSettings } from 'src/app/services/devices.service';
import {
  applyStagePreset,
  buildRecipeFromTemplate,
  GROW_PLAN_TEMPLATES,
  GrowStagePresetId,
} from 'src/app/util/grow-presets';

type WizardStep = 'name' | 'connections' | 'co2' | 'stage' | 'plan' | 'done';

const CLIMATE_DEVICE_TYPES = ['fridge', 'fridge2', 'controller'];

@Component({
  selector: 'setup-wizard',
  templateUrl: './setup-wizard.component.html',
  styleUrls: ['./setup-wizard.component.scss'],
})
export class SetupWizardComponent implements OnInit {
  @Input() device!: DeviceWithParsedSettings;
  /** Enter at the stage/plan part, e.g. from the settings page's "start grow plan". */
  @Input() startAt?: 'stage';
  @Output() closed = new EventEmitter<void>();

  public steps: WizardStep[] = [];
  public stepIndex = 0;
  public deviceName = '';
  public controlProfile: ControlProfile = 'full';
  public hasCo2 = false;
  public selectedStage: GrowStagePresetId | 'custom' | null = null;
  public planChoice: 'targets' | 'photoperiod' | 'autoflower' = 'targets';
  public durations: number[] = [];
  public saving = false;
  public errorSaving = false;

  public planTemplates = GROW_PLAN_TEMPLATES;

  constructor(
    private devices: DeviceService,
    private data: DataService,
    private auth: AuthService,
    private translate: TranslateService,
  ) {}

  get step(): WizardStep {
    return this.steps[this.stepIndex];
  }

  get isClimateDevice(): boolean {
    return CLIMATE_DEVICE_TYPES.includes(this.device?.device_type);
  }

  get isController(): boolean {
    return this.device?.device_type === 'controller';
  }

  get isMonitor(): boolean {
    return this.isController && this.controlProfile === 'monitor';
  }

  get selectedTemplate() {
    return this.planTemplates.find(template => template.id === this.planChoice);
  }

  get totalPlanDays(): number {
    return this.durations.reduce((sum, days) => sum + (Number(days) || 0), 0);
  }

  ngOnInit() {
    this.deviceName = this.device?.name ?? '';
    this.controlProfile = this.device?.cloudSettings?.controlProfile ?? 'full';

    if (this.isClimateDevice) {
      this.steps = ['name', ...(this.isController ? (['connections'] as WizardStep[]) : []), 'co2', 'stage', 'plan', 'done'];
    } else {
      this.steps = ['name', 'done'];
    }

    if (this.startAt === 'stage' && this.isClimateDevice) {
      this.stepIndex = this.steps.indexOf('stage');
    }

    void this.prefillCo2();
  }

  /** A CO2 sensor reports plausible ppm; without one the controller reports -1 or nothing. */
  private async prefillCo2() {
    const co2 = await this.data.latest(this.device.device_id, 'co2');
    if (co2 !== null && co2 > 0) {
      this.hasCo2 = true;
    }
  }

  onPlanChoiceChange() {
    const template = this.selectedTemplate;
    this.durations = template ? template.steps.map(step => step.durationDays) : [];
  }

  canContinue(): boolean {
    switch (this.step) {
      case 'name':
        return this.deviceName.trim().length > 0;
      case 'stage':
        return this.selectedStage !== null;
      default:
        return true;
    }
  }

  isLastInputStep(): boolean {
    return this.steps[this.stepIndex + 1] === 'done';
  }

  next() {
    if (!this.canContinue() || this.saving) {
      return;
    }
    if (this.isLastInputStep()) {
      void this.finish();
      return;
    }
    this.stepIndex += 1;
  }

  back() {
    if (this.stepIndex > 0 && this.step !== 'done') {
      this.stepIndex -= 1;
    }
  }

  close() {
    this.closed.emit();
  }

  trackByIndex(index: number): number {
    return index;
  }

  private async finish() {
    this.saving = true;
    this.errorSaving = false;

    try {
      const device_id = this.device.device_id;
      const name = this.deviceName.trim();

      if (name && name !== this.device.name) {
        await this.devices.setName(device_id, name);
      }

      if (this.isController && this.controlProfile !== (this.device.cloudSettings?.controlProfile ?? 'full')) {
        // Cloud settings are stored as a whole object, so merge to keep
        // firmware channel and webcam configuration intact.
        const currentCloudSettings = await this.devices.getCloudSettings(device_id);
        await this.devices.setCloudSettings(device_id, { ...currentCloudSettings, controlProfile: this.controlProfile });
      }

      if (this.isClimateDevice && this.selectedStage && this.selectedStage !== 'custom') {
        const baseSettings = this.device.settings ?? {};

        if (this.planChoice === 'targets') {
          const settings = applyStagePreset(baseSettings, this.selectedStage, { hasCo2: this.hasCo2 });
          await this.devices.setSettings(device_id, JSON.stringify(settings));

          // Applying manual targets while a plan is running would be undone by
          // the recipe engine, so stop a running plan explicitly.
          const recipe = await this.devices.getRecipe(device_id);
          if (recipe && recipe.activeSince > 0) {
            await this.devices.setRecipe(device_id, { ...recipe, activeSince: 0 });
          }
        } else {
          const template = this.selectedTemplate;
          if (!template) {
            throw new Error('No grow plan template selected');
          }
          const recipe = buildRecipeFromTemplate(template, baseSettings, {
            hasCo2: this.hasCo2,
            durations: this.durations.map(days => Number(days) || 1),
            email: this.auth.current_user.getValue()?.username,
            translate: key => this.translate.instant(key),
          });

          // Start the plan at the stage the grow is currently in.
          const startIndex = template.steps.findIndex(step => step.presetId === this.selectedStage);
          recipe.activeStepIndex = Math.max(0, startIndex);
          recipe.activeSince = Date.now();

          const activeSettings = recipe.steps[recipe.activeStepIndex].settings;
          await this.devices.setRecipe(device_id, {
            ...recipe,
            steps: recipe.steps.map(step => ({ ...step, settings: JSON.stringify(step.settings) })),
          });
          // Push the active step's targets right away instead of waiting for
          // the server-side recipe tick (also covers offline devices).
          await this.devices.setSettings(device_id, JSON.stringify(activeSettings));
        }
      }

      await this.devices.refetchDevices();
      this.stepIndex = this.steps.indexOf('done');
    } catch (error) {
      console.log('Setup wizard failed to apply:', error);
      this.errorSaving = true;
    } finally {
      this.saving = false;
    }
  }
}
