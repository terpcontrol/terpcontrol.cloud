import { EntryWriterService } from '@common/v1/entry-writer.service';
import { DeviceConfigurationService } from '@modules/device-protocol/device-configuration.service';
import { DeviceIngestService } from '@modules/device-protocol/device-ingest.service';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import { HardwareReportService } from '@modules/device-protocol/hardware-report.service';
import { ScheduleFollower } from '@modules/device-protocol/schedule-clock';
import { MqttClientService } from '@modules/mqtt/mqtt-client.service';
import { V1TestDatabase } from './v1-database';

/** What went out to a device, as the broker was handed it. */
export interface Published {
  topic: string;
  message: string;
}

/** The documents among what went out, oldest first. */
export const documentsOf = (published: readonly Published[]): Record<string, unknown>[] => published.map(one => JSON.parse(one.message));

/** A broker that is always up and keeps everything it is handed, in order. */
export const recordingMqtt = (): { mqtt: MqttClientService; published: Published[] } => {
  const published: Published[] = [];
  const mqtt = {
    canPublish: true,
    publish: (topic: string, message: string) => {
      published.push({ topic, message });
      return true;
    },
  } as unknown as MqttClientService;

  return { mqtt, published };
};

/** What writes a device's document and reads what the device sends, wired over a recording broker. */
export const deviceStackOn = (db: V1TestDatabase, followers: ScheduleFollower | null = null) => {
  const { mqtt, published } = recordingMqtt();
  const publisher = new DevicePublisherService(db.devices, mqtt);
  const entries = new EntryWriterService(db.entries);
  const configuration = new DeviceConfigurationService(db.devices, db.users, db.targetChanges, publisher, entries, followers);
  const ingest = new DeviceIngestService(
    db.devices,
    db.cameras,
    db.targetChanges,
    mqtt,
    publisher,
    new HardwareReportService(db.devices, db.cameras),
    entries,
    configuration,
  );

  return { published, configuration, ingest };
};
