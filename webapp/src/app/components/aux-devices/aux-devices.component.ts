import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { WebcamModel } from '@fg2/shared-types';
import { DeviceService } from 'src/app/services/devices.service';
import {
  getWebcamModel,
  hasPlaceholders,
  parseRtspUrl,
  replaceRtspAuthHost,
  WEBCAM_MODELS,
  WebcamCredentialFields,
  WebcamModelTemplate,
} from 'src/app/util/webcam-models';

export const SOCKET_ROLES = ['dehumidifier', 'heater', 'light', 'secondary_light', 'co2'] as const;

const DEVICE_ONLINE_TIMEOUT_MS = 10 * 60 * 1000;
const SOCKET_CONFIRM_POLLS = 3;
const SOCKET_CONFIRM_POLL_MS = 5000;
const SOCKET_TEST_RESET_MS = 6000;

/**
 * "Connected devices" card: one webcam (added via a model picker, then shown
 * as the single configured camera) and the smart sockets the device manages
 * (controllers and fridges both run the socket firmware). Webcam fields
 * follow the page's Save button; socket commands (test / set / remove) go to
 * the device immediately.
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

  /** The model grid only shows while adding — there is exactly one webcam. */
  public addingWebcam = false;
  public terpCamFields: WebcamCredentialFields = { user: '', password: '', host: '' };

  public editingRole: string | null = null;
  public socketDraft = { ip: '', user: '', password: '' };
  public pendingRoles = new Set<string>();
  public testedRoles = new Set<string>();

  /** Add-socket flow, mirroring the webcam add flow. */
  public addingSocket = false;
  public addSocketBrand: 'terp' | 'tasmota' | null = null;
  public addSocketRole = '';

  public testLoading = false;
  public testError: string | null = null;
  public testImageUrl: SafeUrl | null = null;
  private testObjectUrl: string | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private devices: DeviceService,
    private alertController: AlertController,
    private translate: TranslateService,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['cloudSettings']) {
      this.addingWebcam = false;
      this.terpCamFields = parseRtspUrl(this.cloudSettings?.rtspStream) ?? { user: '', password: '', host: '' };
    }
    if (changes['hardwareInfo'] && this.pendingRoles.size > 0) {
      // The device confirms socket changes by re-reporting its csv.
      this.pendingRoles.clear();
    }
  }

  ngOnDestroy() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.clearTestImage();
  }

  get isController(): boolean {
    return this.deviceType === 'controller';
  }

  /** Controllers AND fridges drive smart sockets (both run the socket firmware). */
  get supportsSockets(): boolean {
    return ['controller', 'fridge', 'fridge2'].includes(this.deviceType);
  }

  get hasWebcam(): boolean {
    return !!this.cloudSettings?.rtspStream;
  }

  get isRtsp(): boolean {
    return !!this.cloudSettings?.rtspStream?.startsWith('rtsp://');
  }

  get urlHasPlaceholders(): boolean {
    return hasPlaceholders(this.cloudSettings?.rtspStream);
  }

  get currentModel(): WebcamModelTemplate | undefined {
    return getWebcamModel(this.cloudSettings?.webcamModel) ?? (this.hasWebcam ? getWebcamModel('custom') : undefined);
  }

  get isTerpCam(): boolean {
    return this.cloudSettings?.webcamModel === 'terp_cam';
  }

  /** URL the device reported for a locally paired Terp Control Cam. */
  get terpCamUrl(): string | null {
    const url = this.hardwareInfo?.['webcam_url'];
    return url && url !== 'none' ? url : null;
  }

  get terpCamUrlDiffers(): boolean {
    return !!this.terpCamUrl && this.isTerpCam && this.cloudSettings?.rtspStream !== this.terpCamUrl;
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

  /** Address the controller reported for a role ("role@ip" pairs). */
  socketIp(role: string): string | null {
    const csv = this.hardwareInfo?.['socket_ips'];
    if (!csv || csv === 'none') {
      return null;
    }
    const entry = csv.split(',').find(pair => pair.startsWith(role + '@'));
    return entry ? entry.slice(role.length + 1) : null;
  }

  get freeSocketRoles(): string[] {
    return this.socketRoles.filter(role => this.socketState(role) !== 'connected');
  }

  // --- Webcam -------------------------------------------------------------

  startAddWebcam() {
    this.addingWebcam = true;
  }

  cancelAddWebcam() {
    this.addingWebcam = false;
    this.cloudSettings.rtspStream = '';
    this.cloudSettings.webcamModel = undefined;
    this.cloudSettings.tunnelRtspStream = undefined;
  }

  selectModel(model: WebcamModel) {
    const template = getWebcamModel(model);
    this.cloudSettings.webcamModel = model;

    if (template?.placeholderUrl) {
      this.cloudSettings.rtspStream = template.placeholderUrl;
    } else if (model === 'custom') {
      this.cloudSettings.rtspStream = this.urlHasPlaceholders ? '' : this.cloudSettings.rtspStream ?? '';
    }

    if (model !== 'terp_cam') {
      this.cloudSettings.tunnelRtspStream = !!template?.defaultTunnel;
      if (!this.cloudSettings.rtspStreamTransport) {
        this.cloudSettings.rtspStreamTransport = 'tcp';
      }
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
    this.terpCamFields = parseRtspUrl(this.terpCamUrl) ?? { user: '', password: '', host: '' };
    this.addingWebcam = false;
  }

  /** Terp Control Cam connection edits keep the reported stream path. */
  onTerpCamFieldsChange() {
    if (!this.cloudSettings?.rtspStream || !this.terpCamFields.host.trim()) {
      return;
    }
    this.cloudSettings.rtspStream = replaceRtspAuthHost(this.cloudSettings.rtspStream, this.terpCamFields);
  }

  removeWebcam() {
    this.cloudSettings.rtspStream = '';
    this.cloudSettings.webcamModel = undefined;
    this.cloudSettings.tunnelRtspStream = undefined;
    this.addingWebcam = false;
    this.testError = null;
    this.clearTestImage();
  }

  async testStream() {
    const rtspStream = this.cloudSettings?.rtspStream?.trim();
    if (!rtspStream || this.testLoading || this.urlHasPlaceholders) {
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

  // --- Smart sockets ------------------------------------------------------

  startAddSocket() {
    this.addingSocket = true;
    this.addSocketBrand = null;
    this.addSocketRole = this.freeSocketRoles[0] ?? '';
    this.socketDraft = { ip: '', user: '', password: '' };
    this.editingRole = null;
  }

  cancelAddSocket() {
    this.addingSocket = false;
    this.addSocketBrand = null;
  }

  async applyAddSocket() {
    if (!this.addSocketRole || !this.socketDraftValid) {
      return;
    }
    try {
      await this.devices.sendAuxCommand(this.deviceId, 'socket_set', this.addSocketRole, {
        ip: this.socketDraft.ip.trim(),
        user: this.socketDraft.user.trim(),
        password: this.socketDraft.password.trim(),
      });
      this.markPending(this.addSocketRole);
      this.addingSocket = false;
      this.addSocketBrand = null;
    } catch (e) {
      console.log('Socket add failed:', e);
    }
  }

  startEditSocket(role: string) {
    if (this.editingRole === role) {
      this.editingRole = null;
      return;
    }
    this.editingRole = role;
    this.addingSocket = false;
    // Prefill the reported address; credentials are write-only (empty = keep).
    this.socketDraft = { ip: this.socketIp(role) ?? '', user: '', password: '' };
  }

  get socketDraftValid(): boolean {
    const ip = this.socketDraft.ip.trim();
    return ip.length > 0 && ip.length <= 64 && /^[a-zA-Z0-9._-]+$/.test(ip);
  }

  async applySocketDraft(role: string) {
    if (!this.socketDraftValid) {
      return;
    }
    try {
      await this.devices.sendAuxCommand(this.deviceId, 'socket_set', role, {
        ip: this.socketDraft.ip.trim(),
        user: this.socketDraft.user.trim(),
        password: this.socketDraft.password.trim(),
      });
      this.editingRole = null;
      this.markPending(role);
    } catch (e) {
      console.log('Socket set failed:', e);
    }
  }

  async testSocket(role: string) {
    try {
      await this.devices.sendAuxCommand(this.deviceId, 'socket_test', role);
      this.testedRoles.add(role);
      this.timers.push(setTimeout(() => this.testedRoles.delete(role), SOCKET_TEST_RESET_MS));
    } catch (e) {
      console.log('Socket test failed:', e);
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
      this.markPending(role);
    } catch (e) {
      console.log('Socket removal failed:', e);
    }
  }

  private markPending(role: string) {
    this.pendingRoles.add(role);
    // The device re-reports its sockets; poll a few refetches to pick it up.
    for (let i = 1; i <= SOCKET_CONFIRM_POLLS; i++) {
      this.timers.push(setTimeout(() => void this.devices.refetchDevices(), i * SOCKET_CONFIRM_POLL_MS));
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
