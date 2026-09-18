import { Module } from '@nestjs/common';
import { ModelsModule } from '@database/models.module';
import { V1CommonModule } from '@common/v1/v1.module';
import { TunnelModule } from '@modules/tunnel/tunnel.module';
import { AdminCamerasController } from './admin-cameras.controller';
import { CameraPollerService } from './camera-poller.service';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { CaptureService } from './capture.service';
import { EntitlementService } from './entitlement.service';
import { MediaController } from './media.controller';
import { MediaPresentationService } from './media-presentation.service';
import { MediaService } from './media.service';
import { OptionalSessionGuard } from './optional-session.guard';
import { TerpCamDirectService } from './terpcam-direct.service';
import { TerpCamP2PService } from './terpcam-p2p.service';
import { TerpCamService } from './terpcam.service';
import { TimelapseService } from './timelapse.service';

/**
 * Cameras, and the pictures and films they produce.
 *
 * A tent holds several cameras: the Terp Cam its controller pairs, RTSP cameras
 * pulled through that controller's tunnel, and standalone Terp Cams the cloud
 * reaches itself. The poller reads them, the builder rolls the stills up, both
 * store `media` rows, and the bytes go into the bucket they have always gone in.
 *
 * Two ports are bound where the modules are wired together: `STILL_REQUEST`, to
 * ask a controller for a picture, and `LIGHT_STATE_READER`, which is the one
 * thing `nightOff` needs and is not this module's to know. `TerpCamP2PService`
 * goes the other way, as the protocol module's image sink.
 */
@Module({
  imports: [ModelsModule, V1CommonModule, TunnelModule],
  controllers: [CamerasController, MediaController, AdminCamerasController],
  providers: [
    CamerasService,
    CameraPollerService,
    CaptureService,
    EntitlementService,
    MediaService,
    MediaPresentationService,
    OptionalSessionGuard,
    TerpCamService,
    TerpCamP2PService,
    TerpCamDirectService,
    TimelapseService,
  ],
  exports: [CamerasService, MediaService, EntitlementService, TerpCamP2PService],
})
export class CameraModule {}
