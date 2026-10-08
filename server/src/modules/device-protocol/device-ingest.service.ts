import { Inject, Injectable, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription } from 'rxjs';
import { HARDWARE_INFO_PREFIX, deviceMessageFact, parseDeviceMessage } from '@common/v1/device-messages';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { metricOfField, outputMetricOfField } from '@common/v1/metrics';
import { isSentinel } from '@common/v1/sentinels';
import { BackgroundWork } from '@common/background-work';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { logger } from '@utils/logger';
import { MqttClientService } from '../mqtt/mqtt-client.service';
import { recordTargets } from '../v1/phase/target-record';
import {
  DEVICE_METRIC_SINK,
  DEVICE_PRESENCE_SINK,
  DEVICE_SAMPLE_SINK,
  DEVICE_TUNNEL_SINK,
  DevicePresenceSink,
  DeviceSample,
  DeviceSampleSink,
  DeviceTunnelSink,
  MetricSampleSink,
} from './device-sinks';
import { DeviceConfigurationService } from './device-configuration.service';
import { DevicePublisherService } from './device-publisher.service';
import { HardwareReportService } from './hardware-report.service';
import { heldTo, offTheWire, onTheWire } from './class-rules';
import { withFiguresHeld } from './document-figures';
import { GERMINATION_FORGOTTEN, leftAtDevice } from './germination-memory';
import { sameClockTimes } from './schedule-clock';
import { baseFromUpload, standardOf } from './work-modes';
import { DEVICE_TOPIC_FILTER, DeviceTopic, parseDeviceTopic } from './topics';

/**
 * Everything a device publishes, read once and put where the model keeps it.
 *
 * One subscription covers the fleet, and the device names itself in the topic.
 * A message from an id with no device document is dropped in silence, and a
 * throw while handling one is caught and logged, so one malformed message from
 * one device cannot end the process for all of them.
 *
 * What arrives is the device's vocabulary - snake_case keys, epoch seconds,
 * `message-key:param` lines - and what leaves this file is the model's: readings
 * with an instant, a row of `entries`, a camera, the configuration document.
 */

const MQTT_RECONNECT_DELAY = 5 * 1000;

/**
 * Firmware older than the camera relay reports every still it was asked for,
 * which is diagnostics rather than diary material. Nothing asks it any more, but
 * a device can still be on such a build, and a line it sends is read the same.
 */
const CAM_CAPTURE_PREFIX = 'message-cam-capture:';

/** The device could not take the still it was asked for - a failed capture, said the other way. */
const CAPTURE_NOT_TAKEN = 'message-aux-command-failed:cam_capture';

/** The line a device sends when somebody put it into maintenance mode, on the device or from here. */
const MAINTENANCE_PREFIX = 'message-maintenance-mode-activated';

@Injectable()
export class DeviceIngestService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();
  private messages?: Subscription;
  /**
   * One chain per device, so its messages are handled in the order it sent
   * them. The protocol depends on that order in both directions: a hardware
   * report says `sockets_n` before the rows it counts and `webcam_did` before
   * the address of the camera it names, and each handler reads the device
   * document again to decide what the message means. Handling two at once means
   * deciding twice from the same stale row.
   *
   * Only within one device: a controller with a slow message must not hold up
   * the fleet.
   */
  private readonly inOrder = new Map<string, Promise<void>>();

  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.targetChange) private readonly targetRecord: Model<StoredTargetChange>,
    private readonly mqtt: MqttClientService,
    private readonly publisher: DevicePublisherService,
    private readonly hardware: HardwareReportService,
    private readonly entries: EntryWriterService,
    private readonly configurations: DeviceConfigurationService,
    @Optional() @Inject(DEVICE_SAMPLE_SINK) private readonly samples: DeviceSampleSink | null = null,
    @Optional() @Inject(DEVICE_METRIC_SINK) private readonly metrics: MetricSampleSink | null = null,
    @Optional() @Inject(DEVICE_TUNNEL_SINK) private readonly tunnel: DeviceTunnelSink | null = null,
    @Optional() @Inject(DEVICE_PRESENCE_SINK) private readonly presence: DevicePresenceSink | null = null,
  ) {}

  /**
   * The broker connection is made after the server is built rather than while
   * this file is imported, which is before it can serve a request - and before
   * the database connection is necessarily up.
   */
  public onModuleInit(): void {
    this.work.schedule('The MQTT connection', () => this.connect(), 5000);
  }

  public onApplicationShutdown(): void {
    logger.info('Listening to no more devices');
    this.messages?.unsubscribe();
    this.work.stop();
  }

  private async connect(): Promise<void> {
    try {
      await this.mqtt.connect();
      await this.mqtt.subscribe(DEVICE_TOPIC_FILTER);

      // This method runs again on every failed attempt, and the subject it
      // attaches to outlives the attempt: without dropping the previous
      // subscriber, a retry would leave two, and every device message would be
      // handled twice - two sets of measurements, two diary entries, an alarm
      // evaluated twice.
      this.messages?.unsubscribe();

      // Anything a device sends reaches this, including a payload that does not
      // parse. RxJS drops a rejected promise from an async subscriber, which
      // node then raises as an uncaught exception - so one malformed message
      // from one device would end the process for all of them.
      this.messages = this.mqtt.messages.subscribe(message => {
        void this.queue(message.topic, message.message);
      });
    } catch (error) {
      logger.error(`Could not connect to the MQTT broker: ${error}`);
      // Waited out: retrying straight away spins the CPU and floods the log for
      // as long as the broker is unreachable. A server on its way down does not
      // try again at all.
      this.work.schedule('The MQTT connection', () => this.connect(), MQTT_RECONNECT_DELAY);
    }
  }

  /**
   * Handles one message after everything that device has already sent. A throw
   * is caught here rather than left to RxJS, which drops a rejected promise from
   * an async subscriber - node then raises it as an uncaught exception, and one
   * malformed message from one device would end the process for all of them.
   */
  private queue(topic: string, payload: string): Promise<void> {
    const deviceId = parseDeviceTopic(topic)?.deviceId;
    if (!deviceId) return Promise.resolve();

    const next = (this.inOrder.get(deviceId) ?? Promise.resolve())
      .then(() => this.handle(topic, payload))
      .catch(error => {
        logger.error(`Failed handling an MQTT message from ${topic}: ${error}`);
      });

    this.inOrder.set(deviceId, next);
    // Whoever is last in the queue clears it, so the map holds the devices that
    // are talking rather than every device that ever has.
    void next.then(() => {
      if (this.inOrder.get(deviceId) === next) this.inOrder.delete(deviceId);
    });

    return next;
  }

  /** One message from one device. A topic that is nobody's, or an id with no device document, is dropped in silence. */
  public async handle(name: string, payload: string): Promise<void> {
    const topic = parseDeviceTopic(name);
    if (!topic) return;

    const device = await this.devices.findOne({ id: topic.deviceId }).lean<StoredDevice | null>();
    if (device) await this.dispatch(device, topic, payload);
  }

  private async dispatch(device: StoredDevice, topic: DeviceTopic, payload: string): Promise<void> {
    switch (topic.name) {
      case 'bulk':
        await this.seen(device);
        // The device dates its own samples, and sends none at all until its
        // clock is plausible.
        await this.reading(device, payload, true);
        break;
      case 'status':
        await this.seen(device);
        // A device in custom-MQTT mode publishes one bare value per sensor below
        // this topic, for a broker of its owner's choosing. Those are taken and
        // dropped: the device counts as alive, and there is nothing to record.
        if (!topic.isSubTopic) await this.reading(device, payload, false);
        break;
      case 'fetch':
        await this.fetch(device, payload);
        await this.seen(device);
        break;
      case 'log':
        await this.log(device, payload);
        break;
      case 'configuration': {
        const reported = asRecord(parsed(payload));
        if (reported) await this.configuration(device, reported);
        break;
      }
      case 'tunnel_read':
        await this.tunnel?.onTunnelReadDataReceived(device.id, payload);
        break;
      case 'command':
      case 'firmware':
      case 'tunnel_write':
        // The server's own messages, echoed back by the subscription that covers
        // every topic under a device.
        break;
      case 'image':
        // Still fragments, which firmware older than the camera relay sends when
        // it is asked for a picture. Nothing asks any more, so a stray one is
        // dropped rather than logged at the size of a picture.
        break;
      default:
        logger.info(`Unhandled MQTT message on ${topic.name}: ${payload}`);
    }
  }

  /**
   * That the device is there. It is the one fact every reading, status and fetch
   * carries, and what `offline` is decided from - a device that only logs, only
   * reports hardware or only answers commands does not count as alive.
   */
  private async seen(device: StoredDevice): Promise<void> {
    await this.devices.updateOne({ id: device.id }, { $set: { 'state.lastSeenAt': new Date() } });
    await this.presence?.onDeviceSeen(device.id);
  }

  /**
   * One reading document: stored as the device names its fields, and evaluated
   * under the names the contract gives them.
   *
   * A device nobody owns is heard but not recorded - it is hardware on a bench
   * until somebody claims it, and its readings belong to no grow.
   */
  private async reading(device: StoredDevice, payload: string, dated: boolean): Promise<void> {
    const sample = sampleOf(payload, dated);
    if (!sample || !device.ownerId) return;

    await this.samples?.writeSample(device.id, sample);
    await this.metrics?.onSample({
      deviceId: device.id,
      measuredAt: sample.measuredAt,
      values: renamed(sample.sensors, metricOfField),
      // The device reports an output under its bare name and the store writes it
      // with the `out_` prefix, so the translation goes through the stored field -
      // one table for both directions.
      outputs: renamed(sample.outputs, key => outputMetricOfField(`out_${key}`)),
    });
  }

  /**
   * What a device asks for when it connects: whether it is up to date, and its
   * configuration. The reply is the only one in the protocol.
   *
   * Firmware that knows to sends the settings it runs along with the question.
   * They are kept only where the cloud holds no configuration at all - a device
   * registered afresh, a database restored from before it was set up - because
   * that is the one case the device knows better. A configuration the cloud
   * does hold always wins and is sent down as before: the device's copy may be
   * older than a change made while it was offline, and a reconnect after a
   * dropped connection must not take back what the owner set.
   *
   * A maintenance window the cloud still holds open is said again, for what is
   * left of it. A command is published once and never stored by the broker, so
   * one sent while the device was reconnecting was lost - and the screens went
   * on saying the hardware was parked for a quarter of an hour it never heard
   * about. A device that did hear keeps the same end either way.
   */
  private async fetch(device: StoredDevice, payload: string): Promise<void> {
    const reported = asRecord(parsed(payload));
    const firmwareId = typeof reported?.firmware_id === 'string' ? reported.firmware_id : '';

    if (firmwareId) await this.firmwareReported(device, firmwareId);
    if (device.configuration !== null)
      this.publisher.configuration(device.id, withFiguresHeld(device.type, device.configuration, null).configuration);
    else {
      const running = asRecord(reported?.configuration);
      if (running) await this.configuration(device, running, { onlyIfNone: true });
    }

    const left = (device.state.maintenanceUntil?.getTime() ?? 0) - Date.now();
    if (left >= 60_000) this.publisher.repeatMaintenance(device.id, left / 1000);
  }

  /**
   * The build a device came back running. Whoever is handing out firmware is
   * told before the fact is stored, because deciding whether an update finished
   * means comparing what the device reports now with what it was running.
   */
  private async firmwareReported(device: StoredDevice, firmwareId: string): Promise<void> {
    if (device.state.firmwareId === firmwareId) return;

    await this.presence?.onFirmwareReported(device.id, firmwareId);
    await this.devices.updateOne({ id: device.id }, { $set: { 'state.firmwareId': firmwareId } });
  }

  /**
   * One line of the device's log. Two kinds of line are not diary entries at
   * all: a hardware report rides the same topic, and a capture reports its
   * outcome every half minute, which is diagnostics. A maintenance line is both
   * an entry and the device telling the cloud to stop watching for a while.
   */
  private async log(device: StoredDevice, payload: string): Promise<void> {
    const entry = asRecord(parsed(payload));
    const line = typeof entry?.message === 'string' ? entry.message : '';
    const severity = typeof entry?.severity === 'number' ? entry.severity : 0;
    if (!line) return;

    const trimmed = line.trimStart();
    if (trimmed.startsWith(HARDWARE_INFO_PREFIX)) {
      const info = await this.hardware.report(device, trimmed.slice(HARDWARE_INFO_PREFIX.length));
      if (info?.key === 'firmware_version') await this.firmwareReported(device, info.value);
      return;
    }

    const { message } = parseDeviceMessage(line);
    if (message?.key.startsWith(MAINTENANCE_PREFIX)) await this.maintenance(device, message.params[0]);

    // Only a line about the camera needs one looked up, and the camera is also
    // what says whether its failures are worth writing down.
    const camera = deviceMessageFact(message).aboutCamera
      ? await this.cameras.findOne({ deviceId: device.id, removedAt: null }, { id: 1, logErrors: 1 }).lean()
      : null;

    if (suppressed(line, camera?.logErrors === true)) return;

    await this.entries.writeDeviceLine({
      deviceId: device.id,
      spaceId: device.spaceId,
      cameraId: camera?.id ?? null,
      line,
      severity,
    });
  }

  /** The device says for how many minutes it is being worked on; the cloud silences its own alarms for as long. */
  private async maintenance(device: StoredDevice, minutes: string | undefined): Promise<void> {
    const forMinutes = Number(minutes);
    if (!Number.isFinite(forMinutes) || forMinutes <= 0) return;

    const until = new Date(Date.now() + forMinutes * 60 * 1000);
    await this.devices.updateOne({ id: device.id }, { $set: { 'state.maintenanceUntil': until } });
  }

  /**
   * The device's own configuration, as it has it. It publishes the whole
   * document when a setting is changed on the device itself; the server
   * overwrites its copy.
   *
   * What the server holds the type's document to is held here too, because
   * the device's own menu - and an older app before it - can set any figure;
   * a document that differs from what it is held to is sent back, and the echo
   * of that send is held already and goes no further. The work mode is the
   * device's to change from its menu and is kept as it came, and one it runs on
   * its own is remembered as the one to go back to.
   *
   * Times of day set on the device were set by today's clock, so the clock the
   * old ones were kept on is let go and the schedule loop anchors the new ones
   * on whatever the owner's clock is when it next passes. The server's own
   * sends arrive here too, and leave the times as they were.
   *
   * A device carries a resting humidifier's target as the server sent it
   * (`onTheWire`); what is stored is the night's humidity the server keeps
   * (`offTheWire`), and the echo of a send compares against what was sent. A
   * device that left germination from its own menu gets back what germination
   * kept, and the server lets that memory go (`leftAtDevice`), as it does when
   * germination ends from the cloud.
   *
   * The CO2 coupling spans two devices and neither firmware knows the other: a
   * socket's day and dosing windows set on its own menu are passed on to the fan
   * it slows, and a fan's own upload - which never carries the section the
   * server writes from the socket - keeps that section, which the fan runs by.
   *
   * `onlyIfNone` is the document a fetch carries: it is written only while the
   * stored configuration is still empty, decided by the write itself, so a save
   * from the app that lands between reading the device and writing is kept.
   */
  private async configuration(device: StoredDevice, reported: Record<string, unknown>, { onlyIfNone = false } = {}): Promise<void> {
    const read = withCo2InjectKept(device.type, offTheWire(reported, device.configuration ?? null), device.configuration ?? null);
    const returned = leftAtDevice(device.configuration ?? null, read, device);
    // A figure the firmware itself would misread is not kept, so the server never sends it back.
    const { configuration, dropped } = withFiguresHeld(device.type, heldTo(device.type, returned ?? read), device.configuration ?? null);
    if (dropped.length > 0) logger.warn(`Device ${device.id} sent settings its firmware would misread, not kept: ${dropped.join(', ')}`);
    const base = baseFromUpload(device.type, configuration);
    const retimed = !sameClockTimes(device.configuration, configuration);
    const written = await this.devices.updateOne(onlyIfNone ? { id: device.id, configuration: null } : { id: device.id }, {
      $set: {
        configuration,
        ...(retimed ? { scheduleClock: null } : {}),
        ...(base ? { baseWorkmode: base } : {}),
        ...(standardOf(base) ? { standardWorkmode: standardOf(base) } : {}),
        ...(returned ? GERMINATION_FORGOTTEN : {}),
      },
    });
    if (written.matchedCount === 0) return;
    await recordTargets(this.targetRecord, device, device.configuration, configuration, new Date());

    if (JSON.stringify(onTheWire(configuration)) !== JSON.stringify(reported)) this.publisher.configuration(device.id, configuration);
    if (device.type === 'plug') await this.configurations.followCo2Fan(device.id, device.configuration ?? null, configuration);
  }
}

const withCo2InjectKept = (type: string, reported: Record<string, unknown>, stored: Record<string, unknown> | null): Record<string, unknown> =>
  type === 'fan' && reported.co2inject === undefined && stored?.co2inject !== undefined ? { ...reported, co2inject: stored.co2inject } : reported;

/** A payload that is not JSON is dropped rather than thrown over: a device gets no answer either way. */
const parsed = (payload: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** The numbers of one flat object, as the device sends them. Anything else is not a reading. */
const numbers = (value: unknown): Record<string, number> => {
  const fields = asRecord(value) ?? {};
  const readings: Record<string, number> = {};

  for (const [name, reading] of Object.entries(fields)) {
    const number = Number(reading);
    if (reading !== null && reading !== '' && Number.isFinite(number)) readings[name] = number;
  }

  return readings;
};

/**
 * The same readings with the firmware's "there is nothing here" figures taken
 * out, so that nothing the store keeps from here on has to be recognised as a
 * sentinel on the way back out. What is already behind them is dropped where it
 * is read instead, which is the same rule stated in the same place.
 *
 * A device names its outputs bare and the store writes them with the `out_`
 * prefix, so the prefix goes on before the rule is asked - the rule is about the
 * stored field, which is the one name both ends of the store agree on.
 */
const measurements = (reported: Record<string, number>, prefix = ''): Record<string, number> =>
  Object.fromEntries(Object.entries(reported).filter(([name, value]) => !isSentinel(`${prefix}${name}`, value)));

/**
 * One reading document. `dated` is what tells the two ways of sending one apart:
 * a `bulk` message carries the epoch seconds the device measured at, and a
 * reading that arrives on `status` is recorded at server time.
 */
const sampleOf = (payload: string, dated: boolean): DeviceSample | null => {
  const document = asRecord(parsed(payload));
  if (!document) return null;

  const sensors = measurements(numbers(document.sensors));
  const outputs = measurements(numbers(document.outputs), 'out_');
  if (Object.keys(sensors).length === 0 && Object.keys(outputs).length === 0) return null;

  const timestamp = Number(document.timestamp);
  return { sensors, outputs, measuredAt: dated && timestamp > 0 ? new Date(timestamp * 1000) : new Date() };
};

/**
 * The same reading under the names the contract gives them, which is what a rule
 * is written against. A field the API names nothing for is a diagnostic: it is
 * stored and nothing is evaluated on it.
 */
const renamed = <K extends string>(fields: Record<string, number>, nameOf: (field: string) => K | null): Partial<Record<K, number>> =>
  Object.fromEntries(
    Object.entries(fields).flatMap(([field, value]) => {
      const name = nameOf(field);
      return name ? [[name, value]] : [];
    }),
  ) as Partial<Record<K, number>>;

/**
 * A successful capture never reaches the diary, and a failed one only where the
 * camera's owner asked for its errors to be written down - whichever of the two
 * lines a build says it with. Firmware in the field still sends the successful
 * ones, so the decision is made here as well as on the device.
 */
const suppressed = (line: string, logErrors: boolean): boolean => {
  const trimmed = line.trim();
  if (trimmed.startsWith(`${CAM_CAPTURE_PREFIX}ok`)) return true;
  return (trimmed.startsWith(CAM_CAPTURE_PREFIX) || trimmed === CAPTURE_NOT_TAKEN) && !logErrors;
};
