import {Component, EventEmitter, Input, OnChanges, Output} from "@angular/core";
import {ToastController} from "@ionic/angular";
import {DeviceService} from "../../services/devices.service";
import {UserFirmwareInfo} from "@fg2/shared-types";

/**
 * Cloud-side device settings (VPD offsets, firmware channel). The webcam
 * lives in the shared <aux-devices> card and device deletion in the shared
 * <delete-device-row> on every settings page.
 */
@Component({
  selector: 'cloud-settings',
  templateUrl: './cloud-settings.component.html',
  styleUrls: ['./cloud-settings.component.scss'],
})
export class CloudSettingsComponent implements OnChanges {
  @Input() cloudSettings: any;

  @Input() deviceId: string = '';

  @Input() hardwareInfo: Record<string, string> | undefined;

  @Output() cloudSettingsChange = new EventEmitter<any>();

  public firmwares: UserFirmwareInfo[] = [];
  private firmwaresLoadedForDeviceId: string | null = null;
  private duplicateVersions = new Set<string>();

  constructor(
    private toastController: ToastController,
    private devices: DeviceService,
  ) {}

  ngOnChanges() {
    this.ensureDefaultFirmwareChannel();
    if (this.cloudSettings?.firmwareChannel === 'manual') {
      void this.ensureFirmwaresLoaded();
    }
  }

  onBetaFeaturesChanged() {
    if (this.cloudSettings.firmwareChannel !== 'alpha' && this.cloudSettings.firmwareChannel !== 'manual') {
      this.cloudSettings.firmwareChannel = this.defaultFirmwareChannel();
    }
    this.cloudSettingsChange.emit(this.cloudSettings);
    void this.onFirmwareUpdateChanged();
  }

  async onFirmwareChannelChanged() {
    if (this.cloudSettings.firmwareChannel === 'manual') {
      await this.ensureFirmwaresLoaded();
      if (!this.cloudSettings.pendingFirmware && this.firmwares.length > 0) {
        this.cloudSettings.pendingFirmware = this.firmwares[0].firmware_id;
      }
    }
    this.cloudSettingsChange.emit(this.cloudSettings);
    void this.onFirmwareUpdateChanged();
  }

  async onFirmwareUpdateChanged() {
    if (this.cloudSettings.firmwareChannel && this.cloudSettings.firmwareChannel !== 'stable') {
      const target = this.cloudSettings.firmwareChannel === 'manual'
        ? this.firmwareLabel(this.cloudSettings.pendingFirmware) || 'selected'
        : `latest ${this.cloudSettings.firmwareChannel}`;
      const toast = await this.toastController.create({
        message: `Caution: After saving, your module will update to the ${target} firmware`,
        duration: 10000,
        position: 'top',
      });
      await toast.present();
    }
  }

  firmwareOptionLabel(fw: UserFirmwareInfo): string {
    const installed = fw.current ? '*installed* ' : '';
    const channels = fw.channels.length ? ` [${fw.channels.join(', ')}]` : '';
    const id = this.duplicateVersions.has(fw.version) ? ` (${fw.firmware_id})` : '';
    return `${installed}${fw.version}${channels}${id}`;
  }

  selectedFirmwareLabel(): string {
    const id = this.cloudSettings?.pendingFirmware;
    if (!id) {
      return '';
    }
    const fw = this.firmwares.find(f => f.firmware_id === id);
    return fw ? this.firmwareOptionLabel(fw) : id;
  }

  private firmwareLabel(firmware_id: string | undefined): string {
    const fw = this.firmwares.find(f => f.firmware_id === firmware_id);
    return fw ? this.firmwareOptionLabel(fw) : '';
  }

  private async ensureFirmwaresLoaded() {
    if (!this.deviceId) {
      return;
    }
    if (this.firmwaresLoadedForDeviceId === this.deviceId) {
      return;
    }
    try {
      const result = await this.devices.listFirmwares(this.deviceId);
      this.firmwares = result.firmwares ?? [];
      const counts = new Map<string, number>();
      for (const fw of this.firmwares) {
        counts.set(fw.version, (counts.get(fw.version) ?? 0) + 1);
      }
      this.duplicateVersions = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([v]) => v));
      this.firmwaresLoadedForDeviceId = this.deviceId;
    } catch (e) {
      console.log('Failed to load firmware versions', e);
    }
  }

  private ensureDefaultFirmwareChannel() {
    if (!this.cloudSettings) {
      return;
    }

    if (!this.isFirmwareChannel(this.cloudSettings?.firmwareChannel)) {
      this.cloudSettings.firmwareChannel = this.cloudSettings?.autoFirmwareUpdate === true
        ? this.defaultFirmwareChannel()
        : 'manual';
    }
  }

  private defaultFirmwareChannel() {
    return this.cloudSettings?.betaFeatures ? 'beta' : 'stable';
  }

  private isFirmwareChannel(channel: unknown) {
    return channel === 'stable' || channel === 'beta' || channel === 'alpha' || channel === 'manual';
  }

}
