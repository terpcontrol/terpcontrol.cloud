import {Component, EventEmitter, Input, OnChanges, Output} from "@angular/core";
import {ToastController} from "@ionic/angular";
import {DeviceService} from "../../services/devices.service";
import {Router} from "@angular/router";

@Component({
  selector: 'cloud-settings',
  templateUrl: './cloud-settings.component.html',
  styleUrls: ['./cloud-settings.component.scss'],
})
export class CloudSettingsComponent implements OnChanges {
  @Input() cloudSettings: any;

  @Input() deviceId: string = '';

  @Output() cloudSettingsChange = new EventEmitter<any>();

  constructor(private toastController: ToastController, private devices: DeviceService, private router: Router) {}

  ngOnChanges() {
    this.ensureDefaultFirmwareChannel();
  }

  onAutoFirmwareUpdateChanged() {
    this.ensureDefaultFirmwareChannel();
    this.cloudSettingsChange.emit(this.cloudSettings);
    void this.onFirmwareUpdateChanged();
  }

  onBetaFeaturesChanged() {
    if (this.cloudSettings.firmwareChannel !== 'alpha') {
      this.cloudSettings.firmwareChannel = this.defaultFirmwareChannel();
    }
    this.cloudSettingsChange.emit(this.cloudSettings);
    void this.onFirmwareUpdateChanged();
  }

  async onFirmwareUpdateChanged() {
    if (this.cloudSettings.autoFirmwareUpdate && this.cloudSettings.firmwareChannel && this.cloudSettings.firmwareChannel !== 'stable') {
      const toast = await this.toastController.create({
        message: `Caution: After saving, your module will automatically update to the latest ${this.cloudSettings.firmwareChannel} firmware`,
        duration: 10000,
        position: 'top',
      });
      await toast.present();
    }
  }

  private ensureDefaultFirmwareChannel() {
    if (!this.cloudSettings) {
      return;
    }

    if (!this.isFirmwareChannel(this.cloudSettings?.firmwareChannel)) {
      this.cloudSettings.firmwareChannel = this.defaultFirmwareChannel();
    }
  }

  private defaultFirmwareChannel() {
    return this.cloudSettings?.betaFeatures ? 'beta' : 'stable';
  }

  private isFirmwareChannel(channel: unknown) {
    return channel === 'stable' || channel === 'beta' || channel === 'alpha';
  }

  async deleteDevice() {
    if (confirm('Are you sure you want to delete this device? This action cannot be undone.')) {
      if (confirm('This is your last chance to back out. Do you really want to delete this device?')) {
        await this.devices.unclaim(this.deviceId);
        await this.router.navigateByUrl('/list', { replaceUrl: true });
      }
    }
  }
}
