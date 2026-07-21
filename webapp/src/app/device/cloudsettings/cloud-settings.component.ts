import {Component, EventEmitter, Input, OnChanges, OnDestroy, Output} from "@angular/core";
import {DomSanitizer, SafeUrl} from "@angular/platform-browser";
import {AlertController, ToastController} from "@ionic/angular";
import {TranslateService} from "@ngx-translate/core";
import {DeviceService} from "../../services/devices.service";
import {Router} from "@angular/router";
import {UserFirmwareInfo} from "@fg2/shared-types";

@Component({
  selector: 'cloud-settings',
  templateUrl: './cloud-settings.component.html',
  styleUrls: ['./cloud-settings.component.scss'],
})
export class CloudSettingsComponent implements OnChanges, OnDestroy {
  @Input() cloudSettings: any;

  @Input() deviceId: string = '';

  @Input() deviceType: string = '';

  @Input() hardwareInfo: Record<string, string> | undefined;
  /** Fridge/controller settings render the webcam in the aux-devices card instead. */
  @Input() showWebcam = true;

  @Output() cloudSettingsChange = new EventEmitter<any>();

  public firmwares: UserFirmwareInfo[] = [];
  private firmwaresLoadedForDeviceId: string | null = null;
  private duplicateVersions = new Set<string>();

  public rtspStreamTestLoading = false;
  public rtspStreamTestError: string | null = null;
  public rtspStreamTestImageUrl: SafeUrl | null = null;
  private rtspStreamTestObjectUrl: string | null = null;

  constructor(
    private toastController: ToastController,
    private devices: DeviceService,
    private router: Router,
    private sanitizer: DomSanitizer,
    private alertController: AlertController,
    private translate: TranslateService,
  ) {}

  ngOnDestroy() {
    this.clearRtspStreamTestImage();
  }

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

  async testRtspStream() {
    const rtspStream = this.cloudSettings?.rtspStream?.trim();
    if (!rtspStream || this.rtspStreamTestLoading) {
      return;
    }

    this.rtspStreamTestLoading = true;
    this.rtspStreamTestError = null;
    this.clearRtspStreamTestImage();

    try {
      const image = await this.devices.testWebcamStream(this.deviceId, {
        rtspStream,
        rtspStreamTransport: this.cloudSettings?.rtspStreamTransport,
        tunnelRtspStream: !!this.cloudSettings?.tunnelRtspStream,
      });
      this.rtspStreamTestObjectUrl = URL.createObjectURL(image);
      this.rtspStreamTestImageUrl = this.sanitizer.bypassSecurityTrustUrl(this.rtspStreamTestObjectUrl);
    } catch (e) {
      this.rtspStreamTestError = await this.extractRtspStreamTestError(e);
    } finally {
      this.rtspStreamTestLoading = false;
    }
  }

  private async extractRtspStreamTestError(e: any): Promise<string> {
    // Errors of the blob request arrive as a Blob containing the JSON error body.
    if (e?.error instanceof Blob) {
      try {
        const message = JSON.parse(await e.error.text())?.message;
        if (message) {
          return String(message);
        }
      } catch {
        // fall through to the generic message
      }
    }
    return String(e?.message ?? e ?? 'unknown error');
  }

  private clearRtspStreamTestImage() {
    if (this.rtspStreamTestObjectUrl) {
      URL.revokeObjectURL(this.rtspStreamTestObjectUrl);
      this.rtspStreamTestObjectUrl = null;
    }
    this.rtspStreamTestImageUrl = null;
  }

  async deleteDevice() {
    if (!(await this.confirmDelete(this.translate.instant('settings.deleteDeviceConfirmText')))) {
      return;
    }
    if (!(await this.confirmDelete(this.translate.instant('settings.deleteDeviceConfirmAgain')))) {
      return;
    }
    await this.devices.unclaim(this.deviceId);
    await this.router.navigateByUrl('/list', { replaceUrl: true });
  }

  private async confirmDelete(message: string): Promise<boolean> {
    const alert = await this.alertController.create({
      header: this.translate.instant('settings.deleteDeviceConfirmTitle'),
      message,
      buttons: [
        { text: this.translate.instant('misc.cancel'), role: 'cancel' },
        { text: this.translate.instant('settings.deleteDeviceConfirmButton'), role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'destructive';
  }
}
