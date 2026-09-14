import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { Subscription } from 'rxjs';
import { Device, socketChunkCount, socketListChunk } from '@fg2/shared-types';
import { logger } from '@utils/logger';
import { isSuppressedCamCaptureLog } from '@utils/devicelogs';
import { BackgroundWork } from '../../common/background-work';
import { MODEL } from '../../database/models.module';
import { AlarmService } from '../alarm/alarm.service';
import { TerpCamDirectService } from '../camera/terpcam-direct.service';
import { TerpCamP2PService, TERPCAM_STREAM_PREFIX, TERPCAM_STREAM_PREFIXES } from '../camera/terpcam-p2p.service';
import { DataService } from '../data/data.service';
import { MqttClientService } from '../mqtt/mqtt-client.service';
import { TunnelService } from '../tunnel/tunnel.service';
import { DeviceFirmwareRolloutService } from './device-firmware-rollout.service';
import { DeviceSettingsService } from './device-settings.service';
import { DeviceService } from './device.service';
import { StatusMessage } from './device.types';

const MQTT_RECONNECT_DELAY: number = 5 * 1000;

const DEVICE_MESSAGE_CATEGORY_MAPPING = {
  'message-maintenance-mode-activated': ['device-maintenance'],
  'message-maintenance-mode-activated-remote': ['device-maintenance'],
  'message-smart-socket-cmd-failed': ['device-socket'],
  'message-co2-low': ['device-co2'],
  'message-ext-sensor-fail': ['device-sensor'],
  'message-ext-sensor-deviate': ['device-sensor'],
  'message-device-booted': ['device-boot'],
  'message-device-firmware-update': ['device-firmware'],
  'message-buffer-overflow': ['device-connection'],
  'message-smart-socket-disconnected': ['device-socket'],
  'message-smart-socket-connected': ['device-socket'],
  'message-cam-capture': ['webcam', 'error'],
  'message-cam-reset': ['webcam'],
} as const;

/**
 * The device-facing half of the server: the broker connection, and what each
 * topic a device publishes on is worth - a reading, a diary entry, the firmware
 * it came back running, the hardware it has found.
 */
@Injectable()
export class DeviceMessageService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();
  private messageSubscription?: Subscription;

  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    private readonly mqtt: MqttClientService,
    private readonly deviceService: DeviceService,
    private readonly settings: DeviceSettingsService,
    private readonly rollout: DeviceFirmwareRolloutService,
    private readonly alarms: AlarmService,
    private readonly data: DataService,
    private readonly terpCamP2P: TerpCamP2PService,
    private readonly terpCamDirect: TerpCamDirectService,
    private readonly tunnel: TunnelService,
  ) {}

  /**
   * The broker connection used to be made as this file was imported, which is
   * before the server can serve a request - and before the database connection
   * is necessarily up.
   */
  public onModuleInit(): void {
    this.work.schedule('The MQTT connection', () => this.connectMqtt(), 5000);
  }

  public onApplicationShutdown(): void {
    logger.info('Listening to no more devices');
    this.messageSubscription?.unsubscribe();
    this.work.stop();
  }

  async connectMqtt() {
    try {
      await this.mqtt.connect();

      await this.mqtt.subscribe('/devices/#');

      // This method runs again on every failed attempt, and the subject it
      // attaches to outlives the attempt: without dropping the previous
      // subscriber, a retry would leave two, and every device message would be
      // handled twice - two sets of measurements, two diary entries, an alarm
      // evaluated twice.
      this.messageSubscription?.unsubscribe();

      // Anything a device sends reaches this, including a payload that does not
      // parse. RxJS drops a rejected promise from an async subscriber, which node
      // then raises as an uncaught exception - so one malformed message from one
      // device would end the process for all of them.
      this.messageSubscription = this.mqtt.messages.subscribe(async message => {
        try {
          const device_id = message.topic.split('/')[2];
          const topic = message.topic.split('/')[3];

          const device = await this.devices.findOne({ device_id: device_id });
          if (device) {
            await this.dispatch(device, topic, message.message);
          }
        } catch (error) {
          logger.error(`Failed handling an MQTT message from ${message.topic}: ${error}`);
        }
      });
    } catch (exception) {
      logger.error(`Could not connect to the MQTT broker: ${exception}`);
      // Wait before trying again: retrying straight away spins the CPU and
      // floods the log for as long as the broker is unreachable. A server on
      // its way down does not try again at all.
      this.work.schedule('The MQTT connection', () => this.connectMqtt(), MQTT_RECONNECT_DELAY);
    }
  }

  private async dispatch(device: Device, topic: string, payload: string): Promise<void> {
    switch (topic) {
      case 'status':
        await this.rollout.checkAndUpgrade(device);
        await this.statusMessage(device, { ...JSON.parse(payload), timestamp: undefined });
        break;
      case 'bulk':
        await this.rollout.checkAndUpgrade(device);
        await this.statusMessage(device, JSON.parse(payload));
        break;
      case 'fetch': {
        let parsedMessage;
        try {
          parsedMessage = JSON.parse(payload);
        } catch {
          parsedMessage = payload;
        }

        await this.fetchMessage(device, parsedMessage);
        await this.rollout.checkAndUpgrade(device);
        break;
      }
      case 'log': {
        const msg = JSON.parse(payload);
        if (msg?.message?.startsWith('hardware-info:')) {
          await this.logHardwareInfo(device.device_id, msg.message.slice('hardware-info:'.length));
        } else if (!isSuppressedCamCaptureLog(msg?.message ?? '', device.cloudSettings)) {
          await this.deviceService.logMessage(device.device_id, {
            categories: ['device', ...(DEVICE_MESSAGE_CATEGORY_MAPPING[msg?.message?.split(':')?.[0]] ?? [])],
            ...msg,
          });
        }
        break;
      }
      case 'configuration':
        await this.settings.storeReportedConfiguration(device.device_id, JSON.parse(payload));
        break;
      case 'tunnel_read':
        await this.tunnel.onTunnelReadDataReceived(device.device_id, payload);
        break;
      case 'image':
        this.terpCamP2P.onImageMessage(device.device_id, payload);
        break;
      case 'tunnel_write':
      case 'command':
      case 'firmware':
        break;
      default:
        logger.info(`Unhandled MQTT message on ${topic}: ${payload}`);
    }
  }

  private async statusMessage(device: Device, message: StatusMessage) {
    if (device.owner_id) {
      await this.data.addData(device.device_id, device.owner_id, message);
      await this.alarms.onDataReceived(device.device_id, message);
    }
  }

  /** What a device asks for when it connects: its configuration, and whether it is up to date. */
  private async fetchMessage(device: Device, payload) {
    try {
      if (payload.firmware_id) {
        await this.rollout.onFirmwareReported(device, payload.firmware_id);
      }
    } catch {}

    if (device.configuration != '') {
      this.mqtt.publish('/devices/' + device.device_id + '/configuration', device.configuration);
    }
  }

  private async logHardwareInfo(deviceId: string, infoPayload: string) {
    // Parse a single "key=value" pair, e.g. "co2=on". Values may themselves
    // contain "=" (URLs), so only the first "=" separates key and value.
    const separatorIndex = infoPayload.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }
    const infoKey = infoPayload.slice(0, separatorIndex).trim();
    const infoValue = infoPayload.slice(separatorIndex + 1);
    // The key becomes part of a Mongo update path — reject anything that could
    // escape the hardwareInfo subtree or bloat the document.
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(infoKey) || infoValue.length > 512) {
      return;
    }
    await this.devices.findOneAndUpdate({ device_id: deviceId }, { $set: { [`hardwareInfo.${infoKey}`]: infoValue } });

    if (infoKey === 'sockets_n') {
      await this.dropSupersededSocketChunks(deviceId, Number(infoValue));
    }

    if (infoKey === 'webcam_did') {
      this.terpCamDirect.rememberCamera(deviceId, infoValue);
      await this.reconcileP2PCamera(deviceId, infoValue);
    }

    // Set by the controller at pairing; stored against the device, never logged.
    if (infoKey === 'webcam_pwd') {
      this.terpCamDirect.rememberPassword(deviceId, infoValue);
    }

    // Read off the camera by its controller, so nothing has to be looked up.
    if (infoKey === 'webcam_uid') {
      this.terpCamDirect.rememberUid(deviceId, infoValue);
    }
  }

  /**
   * The socket table arrives as `socket_list<k>` chunks, and a table that has
   * shrunk leaves the chunks of the larger one behind. Readers bound by
   * `sockets_n` ignore them, but a stored report that contradicts itself is a
   * trap for anyone reading the device document, so drop them. The device
   * announces the count before the chunks, so this never removes a chunk that
   * is about to be written.
   */
  private async dropSupersededSocketChunks(deviceId: string, count: number) {
    if (!Number.isInteger(count) || count < 0) {
      return;
    }

    const device = await this.devices.findOne({ device_id: deviceId }, { hardwareInfo: 1 }).lean();
    const stale = Object.keys(device?.hardwareInfo ?? {}).filter(key => (socketListChunk(key) ?? -1) >= socketChunkCount(count));
    if (stale.length === 0) {
      return;
    }

    await this.devices.updateOne({ device_id: deviceId }, { $unset: Object.fromEntries(stale.map(key => [`hardwareInfo.${key}`, ''])) });
  }

  /**
   * Keep the cloud's webcam config in step with what the device reports.
   *
   * For a P2P camera the pairing lives on the device — the user connects it in
   * the module's menu — so the device is the source of truth and the cloud
   * follows. Doing this server-side is what makes pairing "just work": without
   * it the camera is paired but invisible, because the webapp decides whether a
   * webcam exists from cloudSettings.rtspStream, which only a manual add would
   * ever have written.
   *
   * A user's own RTSP URL is never touched. They configured it deliberately,
   * and a device reporting about its P2P pairing says nothing about it; the
   * webapp offers an explicit "use this camera" action for that case instead.
   */
  private async reconcileP2PCamera(deviceId: string, did: string) {
    // Escaped rather than interpolated raw: the prefix is a constant today, but
    // a regex built from a value is a trap waiting for the day it changes.
    const camPrefixPattern = new RegExp('^(' + TERPCAM_STREAM_PREFIXES.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')');

    // Camera gone: drop the stream, or it keeps being shown and polled.
    if (did === 'none' || did === '') {
      await this.devices.findOneAndUpdate(
        { device_id: deviceId, 'cloudSettings.rtspStream': camPrefixPattern },
        { $unset: { 'cloudSettings.rtspStream': '' } },
      );
      return;
    }

    // The id goes into a URL, so accept only the shape a real DID has rather
    // than whatever a device happens to send.
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(did)) {
      return;
    }

    // Adopt it when nothing is configured, or when it replaces a different P2P
    // camera (only one can be paired at a time, so the device's is the one).
    await this.devices.findOneAndUpdate(
      {
        device_id: deviceId,
        $or: [
          { 'cloudSettings.rtspStream': { $in: [null, ''] } },
          { 'cloudSettings.rtspStream': { $exists: false } },
          { 'cloudSettings.rtspStream': camPrefixPattern },
        ],
      },
      { $set: { 'cloudSettings.rtspStream': TERPCAM_STREAM_PREFIX + did, 'cloudSettings.webcamModel': 'terp_cam' } },
    );
  }
}
