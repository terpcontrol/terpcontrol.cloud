import { Global, Module } from '@nestjs/common';
import { AlarmEngineService } from '@modules/alarm/alarm-engine.service';
import { AlarmModule } from '@modules/alarm/alarm.module';
import { DataModule } from '@modules/data/data.module';
import { DataService } from '@modules/data/data.service';
import { DeviceConfigurationService } from '@modules/device-protocol/device-configuration.service';
import { DeviceProtocolModule } from '@modules/device-protocol/device-protocol.module';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import {
  DEVICE_IMAGE_SINK,
  DEVICE_METRIC_SINK,
  DEVICE_PRESENCE_SINK,
  DEVICE_SAMPLE_SINK,
  DEVICE_TUNNEL_SINK,
} from '@modules/device-protocol/device-sinks';
import { TunnelModule } from '@modules/tunnel/tunnel.module';
import { TunnelService } from '@modules/tunnel/tunnel.service';
import { CameraModule } from '@modules/v1/camera/camera.module';
import { LIGHT_STATE_READER } from '@modules/v1/camera/light-state';
import { SERIES_READER } from '@modules/v1/camera/series-reader';
import { STILL_REQUEST } from '@modules/v1/camera/still-request';
import { TerpCamP2PService } from '@modules/v1/camera/terpcam-p2p.service';
import { FirmwareRolloutService } from '@modules/v1/fleet/firmware-rollout.service';
import { FleetModule } from '@modules/v1/fleet/fleet.module';
import { CLIMATE_PRESETS } from '@modules/v1/grow/climate-presets.port';
import { MAINTENANCE_STARTER } from '@modules/v1/diary/maintenance.port';
import { DEVICE_CONFIGURATION_WRITER } from '@modules/v1/plan/device-configuration.port';
import { ClimatePresetsModule, ClimatePresetsService } from '@modules/v1/space/climate-presets.service';

/**
 * Where the slices are joined to each other.
 *
 * Each of them names what it wants from outside as a port and depends on nobody
 * for it: the protocol module hands a reading on without knowing there is a
 * measurement store, the camera pipeline asks for a still without knowing what a
 * controller speaks, the plan says what a device should be running without
 * knowing how it is told. Several of those wants point both ways between the
 * same two modules, so binding them inside either would make a cycle of it - and
 * a slice that imported the module it borrows one function from would drag that
 * module's whole graph along with it.
 *
 * Global, because the binding has to be visible in the module that *consumes* the
 * port, and those are spread across the server. Nothing else is global.
 */
@Global()
@Module({
  imports: [AlarmModule, CameraModule, ClimatePresetsModule, DataModule, DeviceProtocolModule, FleetModule, TunnelModule],
  providers: [
    // What a device published, once it has been read: the measurement store,
    // the alarm state machine, the camera pipeline, the tunnel, and the rollout
    // that decides from a device being there whether it is told to update.
    { provide: DEVICE_SAMPLE_SINK, useExisting: DataService },
    { provide: DEVICE_METRIC_SINK, useExisting: AlarmEngineService },
    { provide: DEVICE_IMAGE_SINK, useExisting: TerpCamP2PService },
    { provide: DEVICE_TUNNEL_SINK, useExisting: TunnelService },
    { provide: DEVICE_PRESENCE_SINK, useExisting: FirmwareRolloutService },
    // What the camera pipeline needs of a controller: a still on request, and
    // whether its light is on, which is the one thing `nightOff` asks.
    { provide: STILL_REQUEST, useExisting: DevicePublisherService },
    { provide: LIGHT_STATE_READER, useExisting: DataService },
    // And what the composer needs of one: the climate it draws over the frames,
    // and the light output that says which of them were taken in the dark.
    { provide: SERIES_READER, useExisting: DataService },
    // The plan puts a device on the settings its step carries, and the protocol
    // module is what knows how to say so.
    { provide: DEVICE_CONFIGURATION_WRITER, useExisting: DeviceConfigurationService },
    // A quarter of an hour in the tent keeps its devices quiet, and the same
    // module is what knows how to tell them.
    { provide: MAINTENANCE_STARTER, useExisting: DevicePublisherService },
    // A grow entering a phase with a preset puts the tent it stands in on that
    // climate, which is the space slice's table and the space slice's write.
    { provide: CLIMATE_PRESETS, useExisting: ClimatePresetsService },
  ],
  exports: [
    DEVICE_SAMPLE_SINK,
    DEVICE_METRIC_SINK,
    DEVICE_IMAGE_SINK,
    DEVICE_TUNNEL_SINK,
    DEVICE_PRESENCE_SINK,
    STILL_REQUEST,
    LIGHT_STATE_READER,
    SERIES_READER,
    DEVICE_CONFIGURATION_WRITER,
    MAINTENANCE_STARTER,
    CLIMATE_PRESETS,
  ],
})
export class WiringModule {}
