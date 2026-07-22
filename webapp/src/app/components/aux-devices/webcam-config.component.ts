import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
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

/**
 * The device's one webcam: model picker while adding, then the model-specific
 * connection form. Terp Control Cams pair on the device (manual entry is an
 * explicit skip and always tunnelled); brand templates prefill a placeholder
 * URL. All fields follow the page's Save button.
 */
@Component({
  selector: 'webcam-config',
  templateUrl: './webcam-config.component.html',
  styleUrls: ['./webcam-config.component.scss'],
})
export class WebcamConfigComponent implements OnChanges, OnDestroy {
  @Input() deviceId = '';
  @Input() cloudSettings: any = {};
  @Input() hardwareInfo: Record<string, string> | undefined;

  public webcamModels = WEBCAM_MODELS;

  /** The model grid only shows while adding — there is exactly one webcam. */
  public addingWebcam = false;
  public terpCamFields: WebcamCredentialFields = { user: '', password: '', host: '' };
  /** Terp hardware pairs on the device; manual entry is an explicit skip. */
  public terpCamManual = false;

  public testLoading = false;
  public testError: string | null = null;
  public testImageUrl: SafeUrl | null = null;
  private testObjectUrl: string | null = null;

  constructor(
    private devices: DeviceService,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['cloudSettings']) {
      this.addingWebcam = false;
      this.terpCamManual = false;
      this.terpCamFields = parseRtspUrl(this.cloudSettings?.rtspStream) ?? { user: '', password: '', host: '' };
    }
  }

  ngOnDestroy() {
    this.clearTestImage();
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

  startAddWebcam() {
    this.addingWebcam = true;
  }

  cancelAddWebcam() {
    this.addingWebcam = false;
    this.terpCamManual = false;
    this.cloudSettings.rtspStream = '';
    this.cloudSettings.webcamModel = undefined;
    this.cloudSettings.tunnelRtspStream = undefined;
  }

  selectModel(model: WebcamModel) {
    const template = getWebcamModel(model);
    this.cloudSettings.webcamModel = model;
    this.terpCamManual = false;

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

  /** Skip pairing and type the cam's address by hand. */
  startTerpCamManual() {
    this.terpCamManual = true;
    this.cloudSettings.tunnelRtspStream = true;
    if (!this.cloudSettings.rtspStreamTransport) {
      this.cloudSettings.rtspStreamTransport = 'tcp';
    }
  }

  /** Terp Control Cam connection edits keep the reported stream path. */
  onTerpCamFieldsChange() {
    const host = this.terpCamFields.host.trim();
    if (!host) {
      return;
    }
    if (this.cloudSettings?.rtspStream) {
      this.cloudSettings.rtspStream = replaceRtspAuthHost(this.cloudSettings.rtspStream, this.terpCamFields);
    } else {
      // Manual setup without a device report: default Terp Cam stream path.
      const auth = this.terpCamFields.user
        ? `${encodeURIComponent(this.terpCamFields.user)}:${encodeURIComponent(this.terpCamFields.password)}@`
        : '';
      this.cloudSettings.rtspStream = `rtsp://${auth}${host}:554/stream1`;
    }
  }

  removeWebcam() {
    this.cloudSettings.rtspStream = '';
    this.cloudSettings.webcamModel = undefined;
    this.cloudSettings.tunnelRtspStream = undefined;
    this.addingWebcam = false;
    this.terpCamManual = false;
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
