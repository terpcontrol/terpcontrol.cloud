import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { WebcamModel } from '@fg2/shared-types';
import { DeviceService } from 'src/app/services/devices.service';
import {
  getWebcamModel,
  parseRtspUrl,
  WEBCAM_MODELS,
  WebcamCredentialFields,
  WebcamModelTemplate,
} from 'src/app/util/webcam-models';

export const SOCKET_ROLES = ['dehumidifier', 'heater', 'light', 'secondary_light', 'co2'] as const;

const DEVICE_ONLINE_TIMEOUT_MS = 10 * 60 * 1000;
const SOCKET_REMOVE_POLLS = 3;
const SOCKET_REMOVE_POLL_MS = 5000;

/**
 * "Connected devices" card: the webcam (with camera-model templates, incl. the
 * Terp Control Cam paired on the device itself) and the smart sockets the
 * controller manages locally. Webcam fields follow the page's Save button;
 * socket removal is sent to the device immediately.
 */
@Component({
  selector: 'aux-devices',
  templateUrl: './aux-devices.component.html',
  styleUrls: ['./aux-devices.component.scss'],
})
export class AuxDevicesComponent implements OnChanges, OnDestroy {
  @Input() deviceId = '';
  @Input() deviceType = '';
  @Input() cloudSettings: any = {};
  @Input() hardwareInfo: Record<string, string> | undefined;
  @Input() lastseen: number | undefined;

  public webcamModels = WEBCAM_MODELS;
  public socketRoles = [...SOCKET_ROLES];
  public selectedModel: WebcamModel | null = null;
  public fields: WebcamCredentialFields = { user: '', password: '', host: '' };
  public removingRoles = new Set<string>();

  public testLoading = false;
  public testError: string | null = null;
  public testImageUrl: SafeUrl | null = null;
  private testObjectUrl: string | null = null;
  private pollTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private devices: DeviceService,
    private alertController: AlertController,
    private translate: TranslateService,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['cloudSettings']) {
      this.selectedModel = this.cloudSettings?.webcamModel ?? (this.cloudSettings?.rtspStream ? 'custom' : null);
      this.fields = parseRtspUrl(this.cloudSettings?.rtspStream) ?? { user: '', password: '', host: '' };
    }
    if (changes['hardwareInfo'] && this.removingRoles.size > 0) {
      // The device confirms a removal by re-reporting its socket csv.
      for (const role of [...this.removingRoles]) {
        if (this.socketState(role) !== 'connected') {
          this.removingRoles.delete(role);
        }
      }
    }
  }

  ngOnDestroy() {
    this.pollTimers.forEach(timer => clearTimeout(timer));
    this.clearTestImage();
  }

  get isController(): boolean {
    return this.deviceType === 'controller';
  }

  get currentTemplate(): WebcamModelTemplate | undefined {
    return getWebcamModel(this.selectedModel ?? undefined);
  }

  get isBrandTemplate(): boolean {
    return !!this.currentTemplate?.buildUrl;
  }

  get hasWebcam(): boolean {
    return !!this.cloudSettings?.rtspStream;
  }

  get isRtsp(): boolean {
    return !!this.cloudSettings?.rtspStream?.startsWith('rtsp://');
  }

  /** URL the device reported for a locally paired Terp Control Cam. */
  get terpCamUrl(): string | null {
    const url = this.hardwareInfo?.['webcam_url'];
    return url && url !== 'none' ? url : null;
  }

  get terpCamApplied(): boolean {
    return this.cloudSettings?.webcamModel === 'terp_cam' && !!this.terpCamUrl && this.cloudSettings?.rtspStream === this.terpCamUrl;
  }

  get socketsReported(): boolean {
    return this.hardwareInfo?.['sockets'] !== undefined;
  }

  get deviceOffline(): boolean {
    return typeof this.lastseen === 'number' && this.lastseen > 0 && Date.now() - this.lastseen > DEVICE_ONLINE_TIMEOUT_MS;
  }

  socketState(role: string): 'connected' | 'not_connected' | 'unknown' {
    const csv = this.hardwareInfo?.['sockets'];
    if (csv === undefined) {
      return 'unknown';
    }
    return csv.split(',').includes(role) ? 'connected' : 'not_connected';
  }

  selectModel(model: WebcamModel) {
    this.selectedModel = model;
    this.cloudSettings.webcamModel = model;
    if (model !== 'terp_cam' && this.cloudSettings.tunnelRtspStream === undefined) {
      this.cloudSettings.tunnelRtspStream = !!this.currentTemplate?.defaultTunnel;
    }
    this.rebuildUrlFromFields();
  }

  /** Brand templates write the stream URL live from the credential fields. */
  rebuildUrlFromFields() {
    const template = this.currentTemplate;
    if (!template?.buildUrl) {
      return;
    }
    if (!this.fields.host.trim()) {
      return;
    }
    this.cloudSettings.rtspStream = template.buildUrl(this.fields);
    if (!this.cloudSettings.rtspStreamTransport) {
      this.cloudSettings.rtspStreamTransport = 'tcp';
    }
  }

  applyTerpCam() {
    if (!this.terpCamUrl) {
      return;
    }
    this.cloudSettings.webcamModel = 'terp_cam';
    this.cloudSettings.rtspStream = this.terpCamUrl;
    this.cloudSettings.tunnelRtspStream = true;
    if (!this.cloudSettings.rtspStreamTransport) {
      this.cloudSettings.rtspStreamTransport = 'tcp';
    }
    this.selectedModel = 'terp_cam';
  }

  removeWebcam() {
    this.cloudSettings.rtspStream = '';
    this.cloudSettings.webcamModel = undefined;
    this.cloudSettings.tunnelRtspStream = undefined;
    this.selectedModel = null;
    this.fields = { user: '', password: '', host: '' };
    this.testError = null;
    this.clearTestImage();
  }

  async testStream() {
    const rtspStream = this.cloudSettings?.rtspStream?.trim();
    if (!rtspStream || this.testLoading) {
      return;
    }

    this.testLoading = true;
    this.testError = null;
    this.clearTestImage();

    try {
      const image = await this.devices.testWebcamStream(this.deviceId, {
        rtspStream,
        rtspStreamTransport: this.cloudSettings?.rtspStreamTransport,
        tunnelRtspStream: !!this.cloudSettings?.tunnelRtspStream,
      });
      this.testObjectUrl = URL.createObjectURL(image);
      this.testImageUrl = this.sanitizer.bypassSecurityTrustUrl(this.testObjectUrl);
    } catch (e) {
      this.testError = await this.extractTestError(e);
    } finally {
      this.testLoading = false;
    }
  }

  async removeSocket(role: string) {
    const alert = await this.alertController.create({
      header: this.translate.instant('auxDevices.sockets.removeConfirmTitle'),
      message: this.translate.instant('auxDevices.sockets.removeConfirmText', {
        role: this.translate.instant('auxDevices.sockets.roles.' + role),
      }),
      buttons: [
        { text: this.translate.instant('misc.cancel'), role: 'cancel' },
        { text: this.translate.instant('auxDevices.sockets.remove'), role: 'destructive' },
      ],
    });
    await alert.present();
    const { role: result } = await alert.onDidDismiss();
    if (result !== 'destructive') {
      return;
    }

    try {
      await this.devices.sendAuxCommand(this.deviceId, 'socket_remove', role);
      this.removingRoles.add(role);
      // The device re-reports its sockets; poll a few refetches to pick it up.
      for (let i = 1; i <= SOCKET_REMOVE_POLLS; i++) {
        this.pollTimers.push(setTimeout(() => void this.devices.refetchDevices(), i * SOCKET_REMOVE_POLL_MS));
      }
    } catch (e) {
      console.log('Socket removal failed:', e);
    }
  }

  trackByRole(_index: number, role: string): string {
    return role;
  }

  trackByModel(_index: number, model: WebcamModelTemplate): string {
    return model.id;
  }

  private async extractTestError(e: any): Promise<string> {
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

  private clearTestImage() {
    if (this.testObjectUrl) {
      URL.revokeObjectURL(this.testObjectUrl);
      this.testObjectUrl = null;
    }
    this.testImageUrl = null;
  }
}
