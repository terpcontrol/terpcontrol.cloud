import { Module } from '@nestjs/common';
import { V1CommonModule } from '@common/v1/v1.module';
import { ModelsModule } from '@database/models.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { DeviceConfigurationService } from './device-configuration.service';
import { DeviceIngestService } from './device-ingest.service';
import { DevicePublisherService } from './device-publisher.service';
import { DeviceProtocolController, LegacyDeviceProtocolController } from './device-protocol.controller';
import { DeviceRegistrationService } from './device-registration.service';
import { FirmwareImageService } from './firmware-image.service';
import { HardwareReportService } from './hardware-report.service';

/**
 * The boundary between the cloud and the hardware.
 *
 * Everything a device touches is here and nowhere else: its four HTTP routes,
 * every MQTT topic in both directions, and the translation between its own
 * vocabulary - snake_case keys, epoch seconds, `message-key:param` lines, flat
 * `hardware-info` keys, the chunked socket table - and the model. All of it is
 * frozen, because not every device in the field will take an update; what it may
 * gain is gated by a capability the device announces.
 *
 * What the rest of the server does with a message it does not decide. The ports
 * in `device-sinks.ts` are what the ingest hands on, and they are optional, so
 * this module keeps recording and keeps answering whatever else is wired in.
 *
 * The broker connection itself stays in `MqttModule`: it is a transport with no
 * device vocabulary in it, and the broker's own authentication backend
 * recognises the server by the credentials it holds.
 */
@Module({
  imports: [ModelsModule, MqttModule, V1CommonModule],
  controllers: [DeviceProtocolController, LegacyDeviceProtocolController],
  providers: [
    DeviceRegistrationService,
    FirmwareImageService,
    HardwareReportService,
    DevicePublisherService,
    DeviceConfigurationService,
    DeviceIngestService,
  ],
  exports: [DevicePublisherService, DeviceConfigurationService, HardwareReportService],
})
export class DeviceProtocolModule {}
