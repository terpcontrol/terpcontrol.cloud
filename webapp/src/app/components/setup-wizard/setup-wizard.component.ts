import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from 'src/app/auth/auth.service';
import { DeviceService, DeviceWithParsedSettings } from 'src/app/services/devices.service';
import {
  applyStagePreset,
  buildRecipeFromTemplate,
  ControlCapability,
  deviceControlCapability,
  deviceHasCo2,
  GROW_PLAN_TEMPLATES,
  GrowPlanTemplateStep,
  GrowStagePresetId,
} from 'src/app/util/grow-presets';
import { EXPERT_MODE_STORAGE_KEY } from 'src/app/util/ui-mode';

type WizardStep = 'name' | 'connections' | 'stage' | 'plan' | 'done';

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

  public stepIndex = 0;
  public deviceName = '';
  public selectedStage: GrowStagePresetId | 'custom' | null = null;
  public planChoice: 'targets' | 'photoperiod' | 'autoflower' = 'targets';
  public durations: number[] = [];
  public saving = false;
  public errorSaving = false;

  public planTemplates = GROW_PLAN_TEMPLATES;

  /** Live copy of the device's hardware report, refreshable mid-wizard. */
  public hardwareInfo: Record<string, string> | undefined;
  public refreshingSockets = false;

  constructor(
    private devices: DeviceService,
    private auth: AuthService,
    private translate: TranslateService,
  ) {}

  get step(): WizardStep {
    return this.steps[this.stepIndex];
  }

  /**
   * The step sequence adapts live to what the hardware can do: a controller
   * without any paired sockets only monitors, so it is not asked for a grow
   * stage or plan — unless the wizard was explicitly opened to start a plan
   * (startAt 'stage'; reference plans are deliberate there).
   */
  get steps(): WizardStep[] {
    if (!this.isClimateDevice) {
      return ['name', 'done'];
    }
    const head: WizardStep[] = this.isController ? ['name', 'connections'] : ['name'];
    if (this.isMonitor && this.startAt !== 'stage') {
      return [...head, 'done'];
    }
    return [...head, 'stage', 'plan', 'done'];
  }

  /** CO2 presence comes from the hardware, not from a wizard question. */
  get hasCo2(): boolean {
    return this.isClimateDevice && deviceHasCo2(this.device);
  }

  get isClimateDevice(): boolean {
    return CLIMATE_DEVICE_TYPES.includes(this.device?.device_type);
  }

  get isController(): boolean {
    return this.device?.device_type === 'controller';
  }

  /** What the controller can switch, derived from its paired sockets. */
  get controlCapability(): ControlCapability {
    return deviceControlCapability({ device_type: this.device?.device_type, hardwareInfo: this.hardwareInfo });
  }

  get isMonitor(): boolean {
    return this.isController && this.controlCapability === 'monitor';
  }

  get socketsReported(): boolean {
    return this.hardwareInfo?.['sockets'] !== undefined;
  }

  // Memoized: template ngFor needs stable array identity across change detection.
  private socketRolesCache: { key: string; value: string[] } = { key: '', value: [] };

  get connectedSocketRoles(): string[] {
    const csv = this.hardwareInfo?.['sockets'] ?? '';
    if (this.socketRolesCache.key !== csv) {
      this.socketRolesCache = {
        key: csv,
        value: csv === 'none' ? [] : csv.split(',').filter(role => role.length > 0),
      };
    }
    return this.socketRolesCache.value;
  }

  /** Re-reads the socket report, e.g. after pairing on the device mid-wizard. */
  async refreshSockets() {
    this.refreshingSockets = true;
    try {
      await this.devices.refetchDevices();
      const fresh = this.devices.devices.getValue().find(device => device.device_id === this.device?.device_id);
      this.hardwareInfo = fresh?.hardwareInfo ?? this.hardwareInfo;
    } finally {
      this.refreshingSockets = false;
    }
  }

  trackByRole(_index: number, role: string): string {
    return role;
  }

  get selectedTemplate() {
    return this.planTemplates.find(template => template.id === this.planChoice);
  }

  /** Index of the step matching the chosen stage — the plan starts there. */
  get planStartIndex(): number {
    const template = this.selectedTemplate;
    if (!template) {
      return 0;
    }
    return Math.max(0, template.steps.findIndex(step => step.presetId === this.selectedStage));
  }

  /**
   * Only the phases still ahead are editable — asking for the length of a
   * phase the grow has already passed makes no sense. Memoized so change
   * detection sees stable row objects.
   */
  private remainingStepsCache: { key: string; value: { step: GrowPlanTemplateStep; index: number }[] } = { key: '', value: [] };

  get remainingPlanSteps(): { step: GrowPlanTemplateStep; index: number }[] {
    const template = this.selectedTemplate;
    if (!template) {
      return [];
    }
    const key = `${template.id}|${this.planStartIndex}`;
    if (this.remainingStepsCache.key !== key) {
      this.remainingStepsCache = {
        key,
        value: template.steps.map((step, index) => ({ step, index })).slice(this.planStartIndex),
      };
    }
    return this.remainingStepsCache.value;
  }

  trackByPlanIndex(_position: number, item: { index: number }): number {
    return item.index;
  }

  get totalPlanDays(): number {
    return this.durations.slice(this.planStartIndex).reduce((sum, days) => sum + (Number(days) || 0), 0);
  }

  ngOnInit() {
    this.deviceName = this.device?.name ?? '';
    this.hardwareInfo = this.device?.hardwareInfo;

    if (this.startAt === 'stage' && this.isClimateDevice) {
      this.stepIndex = this.steps.indexOf('stage');
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
          recipe.activeStepIndex = this.planStartIndex;
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
      // A guided setup should land the user in the guided settings view.
      localStorage.setItem(EXPERT_MODE_STORAGE_KEY, 'false');
      this.stepIndex = this.steps.indexOf('done');
    } catch (error) {
      console.log('Setup wizard failed to apply:', error);
      this.errorSaving = true;
    } finally {
      this.saving = false;
    }
  }
}
