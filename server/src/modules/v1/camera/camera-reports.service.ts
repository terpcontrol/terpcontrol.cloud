import { Injectable } from '@nestjs/common';
import { logIfItFails } from '@common/background-work';
import type { DeviceCameraReportSink } from '@modules/device-protocol/device-sinks';
import { CameraPollerService } from './camera-poller.service';
import { CamerasService } from './cameras.service';
import { TerpCamDirectService } from './terpcam-direct.service';

/**
 * What the camera pipeline does when a device reports something about its Terp
 * Cam: whatever kept the cloud away from that camera is dropped, so it is read
 * at once and on its interval from then on. The relay forgets that the camera
 * refused it, and the poller forgets the backoff - of the device's Terp Cam
 * only, not of the streams tunnelled through the same device, which the report
 * says nothing about.
 *
 * The protocol module tells this after it has written the report, so a pairing
 * finds the camera's row already there.
 */
@Injectable()
export class CameraReportsService implements DeviceCameraReportSink {
  constructor(
    private readonly cameras: CamerasService,
    private readonly poller: CameraPollerService,
    private readonly direct: TerpCamDirectService,
  ) {}

  public cameraReported(deviceId: string): void {
    this.direct.cameraReported(deviceId);
    logIfItFails(`Starting the camera of ${deviceId} over`, this.startOver(deviceId));
  }

  private async startOver(deviceId: string): Promise<void> {
    const camera = await this.cameras.controllerCameraOf(deviceId);
    if (camera) this.poller.cameraReported(camera.id);
  }
}
