import { forwardRef, Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { Subscription } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { isNumeric } from 'influx/lib/src/grammar';
import {
  Alarm,
  CloudSettings,
  Device,
  DeviceAccessInfo,
  DeviceClass,
  DeviceFirmware,
  DeviceFirmwareBinary,
  DeviceLog,
  ClaimCode,
  FirmwareChannel,
  MAX_SOCKETS,
  ShareLink,
  SOCKET_ROLES,
  SocketRole,
  socketChunkCount,
  socketListChunk,
  UserFirmwareList,
} from '@fg2/shared-types';
import { AddDeviceDto, RegisterDeviceDto, TestDeviceDto } from '@modules/device/device.types';
import { HttpException } from '@common/http-exception';
import { logger } from '@utils/logger';
import { hashDevicePassword, verifyDevicePassword } from '@utils/devicepassword';
import { demoAlarms, demoCloudSettings, demoDevice } from '@utils/demo';
import { authConfig } from '../../config/configuration';
import { BackgroundWork, logIfItFails } from '../../common/background-work';
import { toDate } from '../../common/to-date';
import { MODEL } from '../../database/models.module';
import { AlarmService } from '../alarm/alarm.service';
import { OkamP2PService, OKAM_STREAM_PREFIX } from '../camera/okam-p2p.service';
import { DataService } from '../data/data.service';
import { ImageService } from '../image/image.service';
import { MailService } from '../mail/mail.service';
import { TunnelService } from '../tunnel/tunnel.service';
import { MqttClientService } from '../mqtt/mqtt-client.service';

export type StatusMessage = {
  sensors: {
    [key: string]: number;
  };
  outputs: {
    [key: string]: number;
  };
  timestamp: number;
};

const MQTT_RECONNECT_DELAY: number = 5 * 1000;
const UPGRADE_TIMEOUT: number = 10 * 60 * 1000;
const UPGRADE_INSTRUCTION_INITIAL_DELAY: number = 30 * 1000;
const UPGRADE_INSTRUCTION_MAX_DELAY: number = 24 * 60 * 60 * 1000;
export const ONLINE_TIMEOUT: number = 10 * 60 * 1000;
const MAX_OTA_FIRMWARE_BINARY_BYTES = 2 * 1024 * 1024;

const minimal_classes = [
  {
    name: 'fridge',
    description: 'Fridge Controller',
    concurrent: 5,
    maxfails: 10,
  },
  {
    name: 'fan',
    description: 'Fan Controller',
    concurrent: 5,
    maxfails: 10,
  },
  {
    name: 'light',
    description: 'Light Controller',
    concurrent: 5,
    maxfails: 10,
  },
  {
    name: 'plug',
    description: 'Smart Socket',
    concurrent: 5,
    maxfails: 10,
  },
  {
    name: 'controller',
    description: 'FG Controller 2.0',
    concurrent: 5,
    maxfails: 10,
  },
];

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
} as const;

// Alarms stay suppressed until `maintenance_mode_until`, a millisecond epoch that
// not every client can represent exactly - the Garmin watch app parses large JSON
// numbers only imprecisely. Device payloads therefore carry the seconds left as
// well, so a client can count down without doing epoch arithmetic.
const withMaintenanceSecondsLeft = <T extends Partial<Device>>(device: T): T => ({
  ...device,
  maintenance_mode_seconds_left: Math.max(0, Math.ceil(((device.maintenance_mode_until ?? 0) - Date.now()) / 1000)),
});

@Injectable()
export class DeviceService implements OnModuleInit, OnApplicationShutdown {
  private readonly upgradeInstructionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly upgradeInstructionBackoff = new Map<string, { firmwareId: string; nextDelayMs: number }>();
  private readonly work = new BackgroundWork();
  private messageSubscription?: Subscription;

  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    @InjectModel(MODEL.deviceLog) private readonly deviceLogs: Model<DeviceLog & Document>,
    @InjectModel(MODEL.deviceClass) private readonly deviceClasses: Model<DeviceClass & Document>,
    @InjectModel(MODEL.deviceFirmware) private readonly firmwares: Model<DeviceFirmware & Document>,
    @InjectModel(MODEL.deviceFirmwareBinary) private readonly firmwareBinaries: Model<DeviceFirmwareBinary & Document>,
    @InjectModel(MODEL.claimCode) private readonly claimCodes: Model<ClaimCode & Document>,
    private readonly mqtt: MqttClientService,
    private readonly mail: MailService,
    @Inject(forwardRef(() => AlarmService)) private readonly alarms: AlarmService,
    @Inject(forwardRef(() => DataService)) private readonly data: DataService,
    @Inject(forwardRef(() => ImageService)) private readonly imageService: ImageService,
    private readonly okam: OkamP2PService,
    private readonly tunnel: TunnelService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  /**
   * The device-facing half of the server: the broker connection it publishes
   * commands on, and the loops that upgrade firmware and advance grow plans.
   * All of it used to start as this file was imported - two of them writing to
   * the database before anything had connected to it.
   */
  public onModuleInit(): void {
    this.work.run('Creating the device classes', () => this.checkDeviceClasses());
    this.work.run('Backfilling the firmware timestamps', () => this.backfillFirmwareCreatedAt());

    this.work.schedule('The MQTT connection', () => this.connectMqtt(), 5000);
    this.work.repeat('The firmware rollout', () => this.findUpgradeableDevices(), 10000);
    this.work.repeat('The grow plans', () => this.runRecipes(), 20000);
  }

  public onApplicationShutdown(): void {
    this.messageSubscription?.unsubscribe();
    this.work.stop();
    for (const timer of this.upgradeInstructionTimers.values()) clearTimeout(timer);
    this.upgradeInstructionTimers.clear();
  }

  private async backfillFirmwareCreatedAt() {
    try {
      const missing = await this.firmwares.find({ createdAt: { $exists: false } }, { _id: 1 });
      for (const doc of missing) {
        const created = (doc._id as any).getTimestamp?.()?.getTime?.();
        if (typeof created === 'number') {
          await this.firmwares.updateOne({ _id: doc._id }, { $set: { createdAt: created } });
        }
      }
      if (missing.length > 0) {
        logger.info(`Backfilled createdAt for ${missing.length} firmware records`);
      }

      const classes = await this.deviceClasses.find({}, { firmware_id: 1 });
      const stableIds = classes.map(c => c.firmware_id).filter((id): id is string => !!id);
      if (stableIds.length > 0) {
        const result = await this.firmwares.updateMany({ firmware_id: { $in: stableIds }, wasStable: { $ne: true } }, { $set: { wasStable: true } });
        if (result.modifiedCount > 0) {
          logger.info(`Marked ${result.modifiedCount} firmware records as wasStable`);
        }
      }
    } catch (e) {
      logger.error(`Failed to backfill firmware createdAt: ${e}`);
    }
  }

  private async checkDeviceClasses() {
    for (const device_class of minimal_classes) {
      const class_data = await this.findClass(device_class.name);
      if (!class_data) {
        await this.createClass(device_class.name, device_class.description, device_class.concurrent, device_class.maxfails, '');
      }
    }
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
            switch (topic) {
              case 'status':
                await this.checkAndUpgrade(device);
                await this.statusMessage(device, { ...JSON.parse(message.message), timestamp: undefined });
                break;
              case 'bulk':
                await this.checkAndUpgrade(device);
                await this.statusMessage(device, JSON.parse(message.message));
                break;
              case 'fetch':
                let parsedMessage;
                try {
                  parsedMessage = JSON.parse(message.message);
                } catch (e) {
                  parsedMessage = message.message;
                }

                await this.fetchMessage(device, parsedMessage);
                await this.checkAndUpgrade(device);
                break;
              case 'log':
                const msg = JSON.parse(message.message);
                if (msg?.message?.startsWith('hardware-info:')) {
                  await this.logHardwareInfo(device.device_id, msg.message.slice('hardware-info:'.length));
                } else {
                  await this.logMessage(device.device_id, {
                    categories: ['device', ...(DEVICE_MESSAGE_CATEGORY_MAPPING[msg?.message?.split(':')?.[0]] ?? [])],
                    ...msg,
                  });
                }
                break;
              case 'configuration':
                await this.settingsMessage(device, JSON.parse(message.message));
                break;
              case 'tunnel_read':
                await this.tunnel.onTunnelReadDataReceived(device.device_id, message.message);
                break;
              case 'image':
                this.okam.onImageMessage(device.device_id, message.message);
                break;
              case 'tunnel_write':
              case 'command':
              case 'firmware':
                break;
              default:
                logger.info(`Unhandled MQTT message on ${topic}: ${message.message}`);
            }
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

  private resetUpgradeInstructionBackoff(deviceId: string) {
    const timer = this.upgradeInstructionTimers.get(deviceId);
    if (timer) {
      clearTimeout(timer);
      this.upgradeInstructionTimers.delete(deviceId);
    }
    this.upgradeInstructionBackoff.delete(deviceId);
  }

  private effectivePendingFirmware(device: { pending_firmware?: string; cloudSettings?: { pendingFirmware?: string } }): string {
    return device.cloudSettings?.pendingFirmware || device.pending_firmware || '';
  }

  private async checkAndUpgrade(device: Device) {
    await this.devices.findOneAndUpdate({ device_id: device.device_id }, { lastseen: Date.now() });

    const pendingFirmware = this.effectivePendingFirmware(device);
    const needsUpgrade = device.current_firmware != pendingFirmware && !!pendingFirmware;
    if (!needsUpgrade) {
      this.resetUpgradeInstructionBackoff(device.device_id);
      return;
    }

    // One timer per device, and none at all once the server is stopping.
    if (this.upgradeInstructionTimers.has(device.device_id) || this.work.isStopped) {
      return;
    }

    let backoff = this.upgradeInstructionBackoff.get(device.device_id);
    if (!backoff || backoff.firmwareId !== pendingFirmware) {
      backoff = { firmwareId: pendingFirmware, nextDelayMs: UPGRADE_INSTRUCTION_INITIAL_DELAY };
      this.upgradeInstructionBackoff.set(device.device_id, backoff);
    }

    const timer = setTimeout(() => {
      logIfItFails(`The upgrade instruction for device ${device.device_id}`, this.sendUpgradeInstruction(device.device_id));
    }, backoff.nextDelayMs);
    this.upgradeInstructionTimers.set(device.device_id, timer);
  }

  private async sendUpgradeInstruction(deviceId: string) {
    try {
      const device = await this.devices.findOne({ device_id: deviceId });
      const pendingFirmware = device ? this.effectivePendingFirmware(device) : '';
      if (!device || device.current_firmware == pendingFirmware || !pendingFirmware) {
        this.upgradeInstructionBackoff.delete(deviceId);
        return;
      }

      logger.info(
        `Sending instruction to upgrade device ${device.device_id} to firmware ${pendingFirmware} from firmware ${device.current_firmware}`,
      );
      this.mqtt.publish('/devices/' + device.device_id + '/firmware', pendingFirmware);

      const existing = this.upgradeInstructionBackoff.get(deviceId);
      const baseDelay = existing?.firmwareId === pendingFirmware ? existing.nextDelayMs : UPGRADE_INSTRUCTION_INITIAL_DELAY;
      this.upgradeInstructionBackoff.set(deviceId, {
        firmwareId: pendingFirmware,
        nextDelayMs: Math.min(baseDelay * 2, UPGRADE_INSTRUCTION_MAX_DELAY),
      });
    } catch (error) {
      logger.error(`Failed sending the upgrade instruction to device ${deviceId}: ${error}`);
    } finally {
      this.upgradeInstructionTimers.delete(deviceId);
    }
  }

  private async findUpgradeableDevices() {
    const classes = await this.deviceClasses.find();
    for (const device_class of classes) {
      // As in the loops above: a pass awaits its way through every class, so it
      // can outlive the server unless it looks.
      if (this.work.isStopped) break;

      await this.findUpgradeableDevicesByClass(device_class, device_class.firmware_id, this.firmwareChannelQuery('stable'));
      if (device_class.beta_firmware_id) {
        await this.findUpgradeableDevicesByClass(device_class, device_class.beta_firmware_id, this.firmwareChannelQuery('beta'));
      }
      if (device_class.alpha_firmware_id) {
        await this.findUpgradeableDevicesByClass(device_class, device_class.alpha_firmware_id, this.firmwareChannelQuery('alpha'));
      }
    }
  }

  private firmwareChannelQuery(channel: FirmwareChannel): object {
    const legacyAutoUpdateOptedIn = {
      $or: [{ 'cloudSettings.autoFirmwareUpdate': true }, { 'firmwareSettings.autoUpdate': true }],
    };

    if (channel === 'stable') {
      return {
        $or: [
          { 'cloudSettings.firmwareChannel': 'stable' },
          {
            'cloudSettings.firmwareChannel': { $exists: false },
            'cloudSettings.betaFeatures': { $ne: true },
            ...legacyAutoUpdateOptedIn,
          },
        ],
      };
    }

    if (channel === 'beta') {
      return {
        $or: [
          { 'cloudSettings.firmwareChannel': 'beta' },
          {
            'cloudSettings.firmwareChannel': { $exists: false },
            'cloudSettings.betaFeatures': true,
            ...legacyAutoUpdateOptedIn,
          },
        ],
      };
    }

    return { 'cloudSettings.firmwareChannel': channel };
  }

  private pendingFirmwareMatches(firmwareId: string): object {
    return { $or: [{ pending_firmware: firmwareId }, { 'cloudSettings.pendingFirmware': firmwareId }] };
  }

  private pendingFirmwareNotEquals(firmwareId: string): object {
    return {
      $nor: [{ pending_firmware: firmwareId }, { 'cloudSettings.pendingFirmware': firmwareId }],
    };
  }

  private async findUpgradeableDevicesByClass(
    device_class: Omit<DeviceClass, 'firmware_id' | 'beta_firmware_id' | 'alpha_firmware_id'>,
    firmwareId: string,
    additionalQueryConditions?: object,
  ) {
    const currently_upgrading = await this.devices
      .where({
        class_id: device_class.class_id,
        current_firmware: { $ne: firmwareId },
        fwupdate_start: { $gte: Date.now() - UPGRADE_TIMEOUT },
        $and: [this.pendingFirmwareMatches(firmwareId), ...(additionalQueryConditions ? [additionalQueryConditions] : [])],
      })
      .countDocuments();

    const failed = await this.devices
      .where({
        class_id: device_class.class_id,
        current_firmware: { $ne: firmwareId },
        fwupdate_start: { $lte: Date.now() - UPGRADE_TIMEOUT },
        $and: [this.pendingFirmwareMatches(firmwareId), ...(additionalQueryConditions ? [additionalQueryConditions] : [])],
      })
      .countDocuments();

    if (currently_upgrading < device_class.concurrent && failed < device_class.maxfails) {
      const devices: Device[] = await this.devices
        .find({
          lastseen: { $gte: Date.now() - ONLINE_TIMEOUT },
          class_id: device_class.class_id,
          $and: [this.pendingFirmwareNotEquals(firmwareId), ...(additionalQueryConditions ? [additionalQueryConditions] : [])],
        })
        .limit(device_class.concurrent - currently_upgrading);

      for (const device of devices) {
        logger.info('upgrading device ' + device.device_id + ' to firmware ' + firmwareId);
        await this.devices.findByIdAndUpdate(device._id, {
          $set: {
            'cloudSettings.pendingFirmware': firmwareId,
            fwupdate_start: Date.now(),
          },
          $unset: { pending_firmware: '' },
        });
        this.resetUpgradeInstructionBackoff(device.device_id);
      }
    }
    // const stuck_devices: Device[] = await this.devices.find({
    //   lastseen: {$gte: Date.now() - ONLINE_TIMEOUT},
    //   class_id: device_class.class_id,
    //   pending_firmware: {$ne: device_class.firmware_id}
    // })
  }

  private async runRecipes() {
    const devices: Device[] = await this.devices.find({ 'recipe.activeSince': { $gt: 0 } });
    const now = Date.now();

    for (const device of devices) {
      // A pass walks every device and awaits as it goes, so it can outlive the
      // server; stopping here keeps it off a connection that is closing.
      if (this.work.isStopped) break;

      // One device must not end the pass: it may have been deleted since the
      // list was read, and this runs on a timer with no caller to report to.
      try {
        if (device.recipe.activeStepIndex >= device.recipe.steps.length || (device.recipe.activeStepIndex ?? -1) < 0) {
          continue;
        }

        let activeStep = device.recipe.steps[device.recipe.activeStepIndex];
        let hasChanges = false;
        let emailSubject = null;
        let emailBody = null;

        const elapsedMs = now - device.recipe.activeSince;
        const stepDurationMs =
          activeStep.duration *
          60 *
          1000 *
          (activeStep.durationUnit === 'weeks'
            ? 24 * 7 * 60
            : activeStep.durationUnit === 'days'
            ? 24 * 60
            : activeStep.durationUnit === 'hours'
            ? 60
            : 1);
        const remainingMs = stepDurationMs - elapsedMs;
        if (remainingMs <= 0) {
          if (activeStep.waitForConfirmation) {
            if (device.recipe.notifications !== 'off' && !activeStep.notified) {
              emailSubject = `[TERP CONTROL] Recipe step #${device.recipe.activeStepIndex + 1} waiting for confirmation on device ${
                device.device_id
              }`;
              emailBody = `Please confirm the completion of step #${device.recipe.activeStepIndex + 1} ${activeStep.name}: ${
                activeStep.confirmationMessage || 'No additional information provided.'
              }`;

              if (device.recipe.additionalInfo) {
                await this.logMessage(device.device_id, {
                  title: 'message-recipe-step-awaiting-confirmation',
                  message: `message-recipe-step-awaiting-confirmation:${device.recipe.activeStepIndex + 1} (${activeStep.name ?? ''}) - ${
                    activeStep.confirmationMessage || 'No additional information provided.'
                  }`,
                  severity: 0,
                  categories: ['recipe', 'recipe-confirmation'],
                });
              }

              activeStep.notified = true;
              hasChanges = true;
            }
          } else {
            if (device.recipe.activeStepIndex < device.recipe.steps.length - 1) {
              device.recipe.activeStepIndex += 1;
              device.recipe.activeSince = now;
              activeStep = device.recipe.steps[device.recipe.activeStepIndex];
              activeStep.lastTimeApplied = 0;
              activeStep.notified = false;

              logger.info('Advancing to next recipe step ' + device.recipe.activeStepIndex + ' for device ' + device.device_id);

              if (device.recipe.notifications === 'onStep') {
                emailSubject = `[TERP CONTROL] Recipe advanced to step #${device.recipe.activeStepIndex + 1} on device ${device.device_id}`;
                emailBody = `The recipe has advanced to step #${device.recipe.activeStepIndex + 1} ${activeStep.name}`;
              }

              if (device.recipe.additionalInfo) {
                await this.logMessage(device.device_id, {
                  title: 'message-recipe-advanced',
                  message: `message-recipe-advanced:${device.recipe.activeStepIndex + 1} (${activeStep.name ?? ''})`,
                  severity: 0,
                  categories: ['recipe', 'recipe-step'],
                });
              }

              if (activeStep.stage) {
                await this.logStageTransitionIfChanged(device.device_id, activeStep.stage);
              }
            } else if (device.recipe.loop) {
              device.recipe.activeStepIndex = 0;
              device.recipe.activeSince = now;
              activeStep = device.recipe.steps[device.recipe.activeStepIndex];
              activeStep.lastTimeApplied = 0;
              activeStep.notified = false;

              logger.info('Looping recipe to step 0 for device ' + device.device_id);

              if (device.recipe.notifications === 'onStep') {
                emailSubject = `[TERP CONTROL] Recipe looped to step #1 on device ${device.device_id}`;
                emailBody = `The recipe has looped back to step #1 ${activeStep.name}.`;
              }

              if (device.recipe.additionalInfo) {
                await this.logMessage(device.device_id, {
                  title: 'message-recipe-looped',
                  message: `message-recipe-looped:${activeStep.name ?? ''}`,
                  severity: 0,
                  categories: ['recipe', 'recipe-step', 'recipe-looped'],
                });
              }

              if (activeStep.stage) {
                await this.logStageTransitionIfChanged(device.device_id, activeStep.stage);
              }
            } else {
              device.recipe.activeSince = 0;
              device.recipe.activeStepIndex = 0;
              activeStep = null;

              logger.info('Recipe completed for device ' + device.device_id);

              if (device.recipe.notifications === 'onStep') {
                emailSubject = `[TERP CONTROL] Recipe completed on device ${device.device_id}`;
                emailBody = `The recipe has completed all steps on device ${device.device_id}.`;
              }

              if (device.recipe.additionalInfo) {
                await this.logMessage(device.device_id, {
                  title: 'message-recipe-completed',
                  message: 'message-recipe-completed',
                  severity: 0,
                  categories: ['recipe', 'recipe-step', 'recipe-completed'],
                });
              }
            }

            hasChanges = true;
          }
        }

        // The advance is written down before the step is sent. Sending can fail -
        // there may be no broker, or the device may have been deleted since the
        // list was read - and an advance worked out but never stored is worked
        // out again twenty seconds later, with another diary entry and another
        // mail each time.
        if (hasChanges) {
          await this.devices.findByIdAndUpdate(device._id, { recipe: device.recipe });
        }

        const applyStep =
          !!activeStep && (!activeStep.lastTimeApplied || activeStep.lastTimeApplied < now - 3600 * 1000) && device.lastseen >= now - 60 * 1000;
        if (applyStep) {
          // Its own catch: sending the step can fail, and the advance it belongs
          // to has already been stored - so the mail below, which is only ever
          // sent on the pass that advanced, must not be skipped with it.
          try {
            if (await this.configureDevice(device.device_id, activeStep.settings)) {
              logger.info(`Applied recipe step ${device.recipe.activeStepIndex} to device ${device.device_id}`);
            }

            // That it was applied is written down only once it has been, so a
            // send that failed is tried again on the next pass rather than
            // being marked done for the hour the check covers.
            activeStep.lastTimeApplied = now;
            await this.devices.findByIdAndUpdate(device._id, { recipe: device.recipe });
          } catch (error) {
            logger.error(`Could not apply recipe step ${device.recipe.activeStepIndex} to device ${device.device_id}: ${error}`);
          }
        }

        if (emailSubject && emailBody && device.recipe.email) {
          try {
            await this.mail.send({ to: device.recipe.email, subject: emailSubject, text: emailBody });
          } catch (e) {
            logger.error(`Failed to send recipe step notification email for device ${device.device_id}: ${e}`);
          }
        }
      } catch (error) {
        logger.error(`Failed running the grow plan of device ${device.device_id}: ${error}`);
      }
    }
  }

  private async statusMessage(device: Device, message: StatusMessage) {
    if (device.owner_id) {
      await this.data.addData(device.device_id, device.owner_id, message);
      await this.alarms.onDataReceived(device.device_id, message);
    }
  }

  private async fetchMessage(device: Device, payload) {
    //const device_class = await this.deviceClasses.findOne({class_id: device.class_id});
    try {
      if (payload.firmware_id) {
        if (payload.firmware_id != device.current_firmware) {
          if (payload.firmware_id == this.effectivePendingFirmware(device)) {
            const previousFirmwareId = device.current_firmware || 'unknown';
            const [previousFw, newFw] = await Promise.all([
              previousFirmwareId !== 'unknown' ? this.firmwares.findOne({ firmware_id: previousFirmwareId }, { version: 1 }) : null,
              this.firmwares.findOne({ firmware_id: payload.firmware_id }, { version: 1 }),
            ]);
            const previousFirmwareLabel = previousFw?.version || previousFirmwareId;
            const newFirmwareLabel = newFw?.version || payload.firmware_id;
            await this.devices.findByIdAndUpdate(device._id, { current_firmware: payload.firmware_id, fwupdate_end: Date.now() });
            logger.info('device ' + device.device_id + ' finished firmware update, time: ' + (Date.now() - device.fwupdate_start) / 1000 + 's');
            await this.logMessage(device.device_id, {
              title: 'message-firmware-update-complete-with-ids',
              message: `message-firmware-update-complete-with-ids:${previousFirmwareLabel} -> ${newFirmwareLabel}`,
              severity: 0,
              categories: ['device', 'device-firmware'],
            });
          } else {
            await this.devices.findByIdAndUpdate(device._id, { current_firmware: payload.firmware_id });
          }
        }
      }
    } catch (e) {}

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
      await this.reconcileP2PCamera(deviceId, infoValue);
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
    const okamPrefixPattern = new RegExp('^' + OKAM_STREAM_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    // Camera gone: drop the stream, or it keeps being shown and polled.
    if (did === 'none' || did === '') {
      await this.devices.findOneAndUpdate(
        { device_id: deviceId, 'cloudSettings.rtspStream': okamPrefixPattern },
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
          { 'cloudSettings.rtspStream': okamPrefixPattern },
        ],
      },
      { $set: { 'cloudSettings.rtspStream': OKAM_STREAM_PREFIX + did, 'cloudSettings.webcamModel': 'terp_cam' } },
    );
  }

  public async logMessage(
    deviceId: string,
    msg: {
      /** An entry carries a message, a title, or both. */
      message?: string;
      title?: string;
      severity: number;
      raw?: boolean;
      categories: string[];
      data?: Record<string, any>;
      images?: string[];
      deleted?: boolean;
      /** Epoch milliseconds from a client, an ISO string from the device. */
      time?: string | number | Date;
    },
  ) {
    const [messageKey, value] = (msg.message ?? '').split(':');
    if (messageKey?.startsWith('message-maintenance-mode-activated') && isNumeric(value)) {
      await this.alarms.maintenanceActivatedForDevice(deviceId, parseInt(value));
    }

    await this.deviceLogs.create({
      device_id: deviceId,
      message: msg.message,
      title: msg.title || msg.message,
      severity: msg.severity,
      raw: msg.raw,
      categories: msg.categories || [],
      data: msg.data,
      images: msg.images,
      deleted: msg.deleted,
      time: toDate(msg.time),
    });
  }

  /**
   * Writes a diary lifecycle entry when a grow plan moves the device into a new
   * stage. Comparing against the previously logged stage keeps repeated stages
   * (e.g. two consecutive flowering steps) and plain re-saves from spamming the
   * grow diary.
   */
  public async logStageTransitionIfChanged(deviceId: string, stage: string) {
    const lastEntry = await this.deviceLogs
      .findOne({ device_id: deviceId, categories: 'diary-plant-lifecycle', deleted: { $ne: true } })
      .sort({ time: -1 });

    if (lastEntry?.data?.newLifecycleStage === stage) {
      return;
    }

    await this.logMessage(deviceId, {
      title: 'message-diary-plant-lifecycle',
      message: '',
      severity: 0,
      categories: ['diary-plant-lifecycle'],
      data: {
        newLifecycleStage: stage,
        // Keep the grow report's cycle grouping intact by carrying the plant
        // name of the running cycle forward.
        ...(lastEntry?.data?.lifecycleName ? { lifecycleName: lastEntry.data.lifecycleName } : {}),
      },
    });
  }

  public async getDeviceLogs(device_id: string, timestampFrom: number, timestampTo: number, deleted: boolean, categories?: string[]) {
    // Access (ownership, admin, or share link) was already authorized by the controller.
    const device = await this.devices.findOne({ device_id: device_id }, { device_id: 1 });
    if (device) {
      const logs = await this.deviceLogs
        .find({
          device_id: device_id,
          ...(timestampTo || timestampFrom
            ? {
                time: {
                  ...(timestampFrom ? { $gte: new Date(timestampFrom) } : {}),
                  ...(timestampTo ? { $lt: new Date(timestampTo) } : {}),
                },
              }
            : {}),
          ...(deleted ? {} : { deleted: { $ne: true } }),
          ...(categories ? { categories: { $in: categories } } : {}),
        })
        .sort({ time: -1 })
        // Plain objects, so callers may hand out reduced copies of an entry.
        .lean();
      logs.forEach(log => (log.categories = log.categories?.length > 0 ? log.categories : ['unknown']));
      return logs.reverse();
    }
    return [];
  }

  public async deleteDeviceLogs(device_id: string, user_id: string) {
    const device = await this.devices.findOne({ device_id: device_id, owner_id: user_id }, { device_id: 1 });
    if (device) {
      await this.deviceLogs.updateMany({ device_id: device_id }, { $set: { deleted: true } });
    }
  }

  public async deleteDeviceLog(device_id: string, user_id: string, is_admin: boolean, log_id: string) {
    let device;
    if (is_admin) {
      device = await this.devices.findOne({ device_id: device_id }, { device_id: 1 });
    } else {
      device = await this.devices.findOne({ device_id: device_id, owner_id: user_id }, { device_id: 1 });
    }

    if (device) {
      await this.deviceLogs.deleteOne({ _id: log_id, device_id: device_id });
    }
  }

  public async updateDeviceLog(
    device_id: string,
    user_id: string,
    is_admin: boolean,
    log_id: string,
    payload: {
      title?: string;
      message?: string;
      raw?: boolean;
      severity: number;
      categories: string[];
      data?: Record<string, any>;
      images?: string[];
      deleted?: boolean;
      time?: string | number | Date;
    },
  ) {
    let device;
    if (is_admin) {
      device = await this.devices.findOne({ device_id: device_id }, { device_id: 1 });
    } else {
      device = await this.devices.findOne({ device_id: device_id, owner_id: user_id }, { device_id: 1 });
    }

    if (!device) {
      return;
    }

    const update: Record<string, any> = {
      title: payload.title,
      message: payload.message,
      raw: payload.raw,
      severity: payload.severity,
      categories: payload.categories,
      data: payload.data,
      images: payload.images,
      deleted: payload.deleted,
    };

    if (payload.time) {
      update.time = toDate(payload.time);
    }

    await this.deviceLogs.updateOne({ _id: log_id, device_id: device_id }, { $set: update });
  }

  private async settingsMessage(device: Device, message) {
    await this.devices.findOneAndUpdate({ device_id: device.device_id }, { configuration: JSON.stringify(message) });
  }

  public async findAllDevices(): Promise<Device[]> {
    const devices = await this.devices.find({}).lean();
    return devices.map(device => withMaintenanceSecondsLeft(device)) as Device[];
  }

  public async getDeviceBySerial(serialnumber: Number): Promise<Device> {
    const device = await this.devices.findOne({ serialnumber: serialnumber }).lean();
    return (device ? withMaintenanceSecondsLeft(device) : device) as Device;
  }

  /**
   * Publishing on behalf of a caller that is waiting for an answer. The device
   * is not going to hear a command the broker could not take, so saying so
   * beats an ok - a client told this knows to try again.
   */
  private requirePublished(topic: string, message: string): void {
    if (!this.mqtt.publish(topic, message)) {
      throw new HttpException(503, 'Not connected to the message broker');
    }
  }

  public async activateMaintenanceMode(device_id: string, durationMinutes: number): Promise<void> {
    logger.info('Activating maintenance mode for device ' + device_id + ' for ' + durationMinutes + ' minutes');

    this.requirePublished(
      '/devices/' + device_id + '/command',
      JSON.stringify({
        action: 'maintenance',
        durationMinutes,
      }),
    );

    await this.alarms.maintenanceActivatedForDevice(device_id, durationMinutes);
  }

  public async rebootDevice(device_id: string): Promise<void> {
    logger.info('Rebooting device ' + device_id);

    this.requirePublished(
      '/devices/' + device_id + '/command',
      JSON.stringify({
        action: 'reboot',
      }),
    );
  }

  // Commands for auxiliary devices managed by the device itself (smart sockets,
  // Terp Control Cam). Whitelisted so the endpoint can never publish arbitrary
  // actions to the device command topic.
  private static readonly AUX_COMMAND_ACTIONS = ['socket_remove', 'socket_test', 'socket_set'];

  // A role can hold any number of sockets, so a command may name one of them by
  // its slot — the position the device reports it at in `socket_listN`. Left
  // out, the command applies to the role as a whole, which is what it meant
  // when a role could only ever have one socket.
  private static readonly MAX_SOCKET_SLOT = MAX_SOCKETS - 1;

  public async sendAuxDeviceCommand(
    device_id: string,
    action: string,
    role: string,
    options?: { ip?: string; user?: string; password?: string; slot?: number | string; append?: boolean | string },
  ): Promise<void> {
    if (!DeviceService.AUX_COMMAND_ACTIONS.includes(action) || !SOCKET_ROLES.includes(role as SocketRole)) {
      throw new HttpException(400, 'Unknown aux command');
    }

    const payload: Record<string, string | number | boolean> = { action, role };

    if (options?.slot !== undefined && options.slot !== null && options.slot !== '') {
      const slot = Number(options.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot > DeviceService.MAX_SOCKET_SLOT) {
        throw new HttpException(400, 'Invalid socket slot');
      }
      payload['slot'] = slot;
    }

    if (action === 'socket_set') {
      const ip = String(options?.ip ?? '').trim();
      const user = String(options?.user ?? '').trim();
      const password = String(options?.password ?? '').trim();
      // Host or IP the device will call over plain HTTP — keep it simple and bounded.
      if (!ip || ip.length > 64 || !/^[a-zA-Z0-9._-]+$/.test(ip)) {
        throw new HttpException(400, 'Invalid socket address');
      }
      if (user.length > 48 || password.length > 48) {
        throw new HttpException(400, 'Credentials too long');
      }
      payload['ip'] = ip;

      // Credentials are optional. A caller that leaves them out is only
      // re-addressing the socket, and the device then keeps the ones it has —
      // forwarding an empty pair would clear them and lock the device out of a
      // socket that has its own web password. Passing them explicitly replaces
      // them, an empty password meaning "back to the device default".
      if (options?.user !== undefined || options?.password !== undefined) {
        payload['user'] = user;
        payload['password'] = password;
      }

      // Adds a socket to the role instead of configuring the one it has. A
      // caller adding a second heater has no slot to name yet, so it says so
      // here; without it the command keeps its original "configure this role's
      // socket" meaning.
      if (options?.append === true || options?.append === 'true') {
        payload['append'] = true;
      }
    }

    this.requirePublished('/devices/' + device_id + '/command', JSON.stringify(payload));
  }

  public async findUserDevices(user_id: string, is_demo = false): Promise<Device[]> {
    const projection = {
      device_id: 1,
      configuration: 1,
      device_type: 1,
      name: 1,
      maintenance_mode_until: 1,
      cloudSettings: 1,
      hardwareInfo: 1,
      lastseen: 1,
    };

    // lean() gives plain objects: the derived seconds can be attached to them, and
    // the sanitized demo copies cannot carry mongoose internals (or the untouched
    // original) along.
    if (is_demo) {
      const demoDevices = await this.devices.find({ demoDevice: true }, projection).lean();
      return demoDevices.map(device => withMaintenanceSecondsLeft(demoDevice(device))) as Device[];
    }

    const devices = await this.devices.find({ owner_id: user_id }, projection).lean();
    // const users: Device[] = await this.devices.aggregate([{$match: {owner_id: user_id}}, {$lookup: {from: 'deviceclasses', localField:'class_id', foreignField: 'class_id', as:'device_class'}}]);
    return devices.map(device => withMaintenanceSecondsLeft(device)) as Device[];
  }

  public async register(info: RegisterDeviceDto): Promise<any> {
    logger.info(`Registering device ${info?.device_id} of type ${info?.device_type}`);

    if (!this.config.enableSelfRegistration) {
      logger.info('REGISTRATION DISABLED');
      return false;
    }
    if (info.registration_password != this.config.selfRegistrationPassword) {
      logger.info('WRONG PASSWORD');
      return false;
    }

    const device_class = await this.deviceClasses.findOne({ name: info.device_type });

    // Firmware naming a type this server does not know cannot be enrolled, and
    // reading the class it did not find is how that used to end as a 500.
    if (!device_class) {
      logger.info(`Registration refused: no device class named ${info.device_type}`);
      return false;
    }

    const existingDevice = await this.devices.findOne({
      device_id: info.device_id,
      username: info.username,
      device_type: info.device_type,
    });

    if (existingDevice) {
      const { matches, legacy } = await verifyDevicePassword(info.password, existingDevice.password);
      if (!matches) {
        logger.info('WRONG DEVICE PASSWORD');
        return false;
      }

      const update: any = {
        $set: {
          'cloudSettings.pendingFirmware': device_class.firmware_id,
          'cloudSettings.firmwareChannel': 'manual',
          'hardwareInfo.claimcode_auth': 'off',
        },
        $unset: { 'cloudSettings.autoFirmwareUpdate': '', pending_firmware: '' },
      };
      // Migrate legacy plaintext records to a hash on successful re-registration.
      if (legacy) {
        update.$set.password = await hashDevicePassword(info.password);
      }
      await this.devices.updateOne({ _id: existingDevice._id }, update);

      logger.info(`Re-registered existing device ${existingDevice.device_id}`);
      return { fw: device_class.firmware_id };
    }

    let serial = 0;

    try {
      const serialquery = await this.devices.aggregate([
        {
          $group: {
            _id: null,
            serial: { $max: '$serialnumber' },
          },
        },
      ]);

      serial = parseInt(serialquery?.[0]?.serial) || 0;
    } catch (err) {
      // The next serial number is a nicety; registration goes on without it.
      logger.error(`Could not read the highest serial number: ${err}`);
    }

    serial = serial + 1;

    const device: Device = {
      device_id: info.device_id,
      username: info.username,
      password: await hashDevicePassword(info.password),
      class_id: device_class.class_id,
      device_type: info.device_type,
      configuration: '',
      owner_id: '',
      serialnumber: serial,
      current_firmware: '',
      lastseen: 0,
      fwupdate_end: 0,
      fwupdate_start: 0,
      cloudSettings: { pendingFirmware: device_class.firmware_id },
    };

    try {
      try {
        await this.devices.deleteOne({ device_id: info.device_id, owner_id: '' }); // remove unclaimed device with same id
      } catch (err) {}
      await this.devices.create(device);
      logger.info(`Registered new device ${device?.device_id}`);

      return { fw: device_class.firmware_id };
    } catch (err) {
      logger.error(`Device registration failed: ${err}`);
      return false;
    }
  }

  public async create(info: AddDeviceDto): Promise<Device> {
    const serialquery = await this.devices.aggregate([
      {
        $group: {
          _id: null,
          serial: { $max: '$serialnumber' },
        },
      },
    ]);

    let serial = parseInt(serialquery?.[0]?.serial) || 0;
    serial = serial + 1;

    const device_class = await this.deviceClasses.findOne({ class_id: info.class_id });

    // The class decides which firmware the new device is told to run, so there
    // is nothing to create without one - reading it anyway answered 500.
    if (!device_class) {
      throw new HttpException(404, 'Device class not found');
    }

    const plainPassword = uuidv4();
    const device: Device = {
      device_id: uuidv4(),
      username: uuidv4(),
      password: plainPassword,
      class_id: info.class_id,
      device_type: info.device_type,
      configuration: '',
      owner_id: '',
      serialnumber: serial,
      current_firmware: '',
      lastseen: 0,
      fwupdate_end: 0,
      fwupdate_start: 0,
      cloudSettings: { pendingFirmware: device_class.firmware_id },
    };

    await this.devices.create({ ...device, password: await hashDevicePassword(plainPassword) });
    // Return the plaintext password so it can be flashed onto the hardware; only the hash is persisted.
    return device;
  }

  private genClaimCode(): string {
    const chars = [
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'K',
      'M',
      'N',
      'P',
      'R',
      'S',
      'T',
      'U',
      'V',
      'W',
      'X',
      'Y',
      'Z',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ];
    const len = 6;
    let code = '';

    for (let i = 0; i < len; i++) {
      const char = chars[Math.round(Math.random() * (chars.length - 1))];
      code += char;
    }

    return code;
  }

  public async getClaimCode(device_id: string, password?: string): Promise<{ claim_code: string } | false> {
    const device = await this.devices.findOne({ device_id: device_id });
    if (!device) {
      return false;
    }

    const requiresAuth = device.hardwareInfo && (device.hardwareInfo as any).claimcode_auth === 'on';
    if (requiresAuth) {
      if (typeof password !== 'string' || typeof device.password !== 'string') {
        return false;
      }
      const { matches, legacy } = await verifyDevicePassword(password, device.password);
      if (!matches) {
        return false;
      }
      if (legacy) {
        await this.devices.updateOne({ _id: device._id }, { $set: { password: await hashDevicePassword(password) } });
      }
    }

    let code = '';
    let doc = null;
    do {
      code = this.genClaimCode();
      doc = await this.claimCodes.findOne({ claim_code: code });
    } while (doc); // ensure unique code

    await this.claimCodes.findOneAndUpdate({ device_id: device_id }, { claim_code: code, device_id: device_id }, { upsert: true });

    return { claim_code: code };
  }

  public async claimDevice(claim_code: string, user_id: string): Promise<string | null> {
    const dev = await this.claimCodes.findOne({ claim_code: claim_code });
    if (dev) {
      logger.info('Claiming device ' + dev.device_id + ' for user ' + user_id);
      // Awaited, or the query is never sent and the code stays claimable.
      await this.claimCodes.deleteOne({ claim_code: claim_code });
      await this.devices.findOneAndUpdate({ device_id: dev.device_id }, { owner_id: user_id });
      return dev.device_id;
    } else {
      logger.info('Invalid claim code ' + claim_code + ' for user ' + user_id);
      return null;
    }
  }

  public async unClaimDevice(device_id: string) {
    await this.devices.findOneAndUpdate({ device_id: device_id }, { owner_id: '' });
  }

  /**
   * Who may configure a device is settled before this is called - by the guard
   * on the route, which lets an admin configure one they do not own. Matching
   * the owner here as well only made that case store nothing while still
   * telling the hardware to change, so the device reverted on its next fetch.
   */
  public async configureDevice(device_id: string, config: string): Promise<boolean> {
    // Asked before anything is written: a caller that cannot be served should
    // find nothing changed, rather than a stored configuration it was told had
    // failed and a diary entry that a retry will no longer have a diff for.
    if (!this.mqtt.isConnected) {
      throw new HttpException(503, 'Not connected to the message broker');
    }

    const previous = await this.devices.findOneAndUpdate({ device_id: device_id }, { configuration: config }, { returnOriginal: true });

    if (!previous) {
      throw new HttpException(404, 'Device not found');
    }

    // Not required after the write: the device asks for its configuration when
    // it connects, and is answered from what is stored - so a send that fails
    // between the check above and here costs a delay, not the setting.
    this.mqtt.publish('/devices/' + device_id + '/configuration', config);
    await this.claimCodes.deleteMany({ device_id: device_id });

    const diffStr = this.diffConfigs(previous.configuration, config);
    if (previous.configuration !== config && diffStr.length > 0) {
      await this.logMessage(device_id, {
        title: 'message-device-configuration-updated',
        message: `message-device-configuration-updated:${diffStr}`,
        severity: 0,
        categories: ['device', 'device-configuration'],
        deleted: true,
      });
      return true;
    }

    return false;
  }

  private diffConfigs(oldConfigJson: string, newConfigJson: string): string {
    try {
      const oldConfig = JSON.parse(oldConfigJson);
      const newConfig = JSON.parse(newConfigJson);

      const diff: Record<string, { old: any; new: any }> = {};
      const readConfigKeys = (obj: any, targetKey: 'old' | 'new', prefix = '') => {
        for (const key in obj) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          if (typeof obj[key] === 'object' && obj[key] !== null) {
            readConfigKeys(obj[key], targetKey, fullKey);
          } else {
            if (!(fullKey in diff)) {
              diff[fullKey] = { old: undefined, new: undefined };
            }
            diff[fullKey][targetKey] = obj[key];
          }
        }
      };

      readConfigKeys(oldConfig, 'old');
      readConfigKeys(newConfig, 'new');

      return Object.entries(diff)
        .filter(([_, change]) => change.old !== change.new)
        .filter(([key, _]) => key !== 'daynight.float_start' || diff['daynight.floating']?.new)
        .map(([key, change]) => `    ${key}: ${change.old} -> ${change.new}`)
        .join('\n');
    } catch (e) {
      return 'Could not parse configuration for diff: ' + e.message;
    }
  }

  public async setDeviceAlarms(device_id: string, alarms: Alarm[]): Promise<void> {
    const device = await this.devices.findOne({ device_id: device_id });

    if (!device) {
      throw new HttpException(404, 'Device not found or access denied');
    }

    for (const alarm of alarms) {
      if (!alarm.alarmId) {
        alarm.alarmId = uuidv4();
      }
    }

    await this.devices.updateOne({ device_id: device_id }, { alarms: alarms });
    this.alarms.invalidateAlarmCache(device_id);
  }

  public async setDeviceCloudSettings(device_id: string, settings: CloudSettings) {
    const device = await this.devices.findOne({ device_id: device_id });

    if (!device) {
      throw new HttpException(404, 'Device not found or access denied');
    }

    const normalizedSettings = this.normalizeCloudSettings(settings);
    if (!this.isFirmwareChannel(normalizedSettings.firmwareChannel)) {
      throw new HttpException(400, 'Invalid firmware channel');
    }

    const previousPending = this.effectivePendingFirmware(device);

    if (normalizedSettings.firmwareChannel === 'manual') {
      const requested = normalizedSettings.pendingFirmware?.trim();
      if (!requested) {
        throw new HttpException(400, 'Manual channel requires a firmware version');
      }

      if (requested !== previousPending) {
        const firmware = await this.firmwares.findOne({ firmware_id: requested, class_id: device.class_id });
        if (!firmware) {
          throw new HttpException(400, 'Selected firmware is not available for this device');
        }
      }

      normalizedSettings.pendingFirmware = requested;
    } else {
      normalizedSettings.pendingFirmware = previousPending || undefined;
    }

    device.cloudSettings = normalizedSettings;

    const set: Record<string, any> = { cloudSettings: normalizedSettings, firmwareSettings: {} };
    if (normalizedSettings.firmwareChannel === 'manual' && normalizedSettings.pendingFirmware !== previousPending) {
      set.fwupdate_start = Date.now();
    }

    await this.devices.updateOne({ device_id: device_id }, { $set: set, $unset: { pending_firmware: '' } });
    this.imageService.reportDeviceConfigured(device_id);
  }

  public async setDeviceName(device_id: string, name: string): Promise<void> {
    const updated = await this.devices.findOneAndUpdate({ device_id: device_id }, { name: name });

    if (!updated) {
      throw new HttpException(404, 'Device not found');
    }
  }

  // Which devices the caller may see at all is decided by the auth middleware;
  // these filters keep a mismatched device id from answering with someone else's device.
  private deviceAccessFilter(device_id: string, user_id: string, is_admin: boolean, is_demo: boolean) {
    if (is_admin) return { device_id: device_id };
    if (is_demo) return { device_id: device_id, demoDevice: true };
    return { device_id: device_id, owner_id: user_id };
  }

  public async getDeviceConfig(device_id: string, user_id: string, is_admin: boolean, is_demo = false) {
    const device = await this.devices.findOne(this.deviceAccessFilter(device_id, user_id, is_admin, is_demo), { configuration: 1 });
    return device?.configuration;
  }

  public async getDeviceAlarms(device_id: string, user_id: string, is_admin = false, is_demo = false) {
    const device = await this.devices.findOne(this.deviceAccessFilter(device_id, user_id, is_admin, is_demo), { alarms: 1 }).lean();
    const alarms = (device?.alarms ?? []) as Alarm[];
    return is_demo ? demoAlarms(alarms) : alarms;
  }

  private normalizeCloudSettings(cloudSettings: CloudSettings | undefined, firmwareSettings?: { autoUpdate?: boolean }) {
    const settings: CloudSettings = cloudSettings ?? {};

    if (settings.firmwareChannel === undefined) {
      const legacyAutoUpdate = settings.autoFirmwareUpdate ?? firmwareSettings?.autoUpdate;
      if (legacyAutoUpdate === true) {
        settings.firmwareChannel = settings.betaFeatures ? 'beta' : 'stable';
      } else {
        settings.firmwareChannel = 'manual';
      }
    }

    if (settings.vpdLeafTempOffsetDay === undefined) {
      settings.vpdLeafTempOffsetDay = -2;
    }

    if (settings.vpdLeafTempOffsetNight === undefined) {
      settings.vpdLeafTempOffsetNight = 0;
    }

    if (settings.logRtspStreamErrors === undefined) {
      settings.logRtspStreamErrors = true;
    }

    if (!settings.rtspStreamTransport) {
      settings.rtspStreamTransport = 'tcp';
    }

    // An out-of-enum webcamModel would make the strict schema fail the whole
    // save — drop it instead so older/foreign clients keep working.
    if (settings.webcamModel !== undefined && !['terp_cam', 'tapo_c200', 'reolink', 'hikvision', 'custom'].includes(settings.webcamModel)) {
      delete settings.webcamModel;
    }

    return settings;
  }

  private isFirmwareChannel(channel: unknown): channel is FirmwareChannel {
    return channel === 'stable' || channel === 'beta' || channel === 'alpha' || channel === 'manual';
  }

  public async getDeviceCloudSettings(device_id: string) {
    const device = await this.devices.findOne({ device_id: device_id }, { firmwareSettings: 1, cloudSettings: 1 });
    return this.normalizeCloudSettings(device?.cloudSettings, device?.firmwareSettings);
  }

  public async getDeviceAccessInfo(device_id: string, user_id?: string, is_admin = false, is_demo = false): Promise<DeviceAccessInfo | null> {
    // lean() as in the shared variant below: the demo copy is built by spreading
    // these settings, and a hydrated subdocument carries the whole device - the
    // untouched stream URL, credentials and all - along into the answer.
    const device = await this.devices
      .findOne({ device_id: device_id }, { firmwareSettings: 1, cloudSettings: 1, device_type: 1, name: 1, owner_id: 1, demoDevice: 1 })
      .lean();
    if (!device) {
      return null;
    }

    const cloudSettings = this.normalizeCloudSettings(device.cloudSettings, device.firmwareSettings);
    const isOwned = is_admin || (!!user_id && device.owner_id === user_id);
    const isDemoAccess = is_demo && !!device.demoDevice;

    if (!isOwned && !isDemoAccess) {
      return null;
    }

    return {
      device_id: device_id,
      device_type: device.device_type,
      name: device.name,
      isPublic: false,
      cloudSettings: isDemoAccess ? demoCloudSettings(cloudSettings) : cloudSettings,
    };
  }

  // Access info handed to visitors of a share link: no secrets (the RTSP URL is
  // reduced to a presence flag) and the webcam only when the link includes it.
  public async getSharedDeviceAccessInfo(share: ShareLink): Promise<DeviceAccessInfo | null> {
    // lean() returns plain objects, so spreading below cannot leak mongoose internals.
    const device = await this.devices
      .findOne({ device_id: share.device_id }, { firmwareSettings: 1, cloudSettings: 1, device_type: 1, name: 1 })
      .lean();
    if (!device) {
      return null;
    }

    const cloudSettings = this.normalizeCloudSettings(device.cloudSettings, device.firmwareSettings);

    return {
      device_id: share.device_id,
      device_type: device.device_type,
      name: device.name,
      isPublic: true,
      cloudSettings: {
        ...cloudSettings,
        rtspStream: cloudSettings.rtspStream && share.webcam ? '1' : undefined,
      },
      share: {
        share_id: share.share_id,
        page: share.page,
        editable: share.editable,
        webcam: share.webcam,
        charts: !!share.charts,
        // View-only visitors render the view stored with the link, not the URL.
        query: share.query,
        expiresAt: share.expiresAt ?? null,
      },
    };
  }

  public async listClasses(): Promise<DeviceClass[]> {
    const classes: DeviceClass[] = await this.deviceClasses.find({});
    return classes;
  }

  public async getClass(class_id: string): Promise<DeviceClass> {
    const classes: DeviceClass = await this.deviceClasses.findOne({ class_id: class_id });
    return classes;
  }

  public async findClass(class_name: string): Promise<DeviceClass> {
    const classes: DeviceClass = await this.deviceClasses.findOne({ name: class_name });
    return classes;
  }

  public async createClass(
    name: string,
    description: string,
    concurrent: number,
    maxfails: number,
    firmware_id: string,
    beta_firmware_id?: string | null,
    alpha_firmware_id?: string | null,
  ): Promise<DeviceClass> {
    const device_class: DeviceClass = {
      class_id: uuidv4(),
      name: name,
      description: description,
      concurrent: concurrent,
      maxfails: maxfails,
      firmware_id: firmware_id,
      beta_firmware_id,
      alpha_firmware_id,
    };

    await this.deviceClasses.create(device_class);
    await this.markStableFirmware(firmware_id);
    return device_class;
  }

  private async markStableFirmware(firmware_id: string | undefined) {
    if (!firmware_id) {
      return;
    }
    await this.firmwares.updateOne({ firmware_id: firmware_id }, { $set: { wasStable: true } });
  }

  public async testOutputs(device_id: string, outputs: TestDeviceDto) {
    this.requirePublished(
      '/devices/' + device_id + '/command',
      JSON.stringify({
        action: 'test',
        outputs: {
          heater: outputs.heater,
          dehumidifier: outputs.dehumidifier,
          co2: outputs.co2,
          lights: outputs.lights,
          fanint: outputs.fanint,
          fanext: outputs.fanext,
          fanbw: outputs.fanbw,
        },
      }),
    );
  }

  public async stopTest(device_id: string) {
    this.requirePublished(
      '/devices/' + device_id + '/command',
      JSON.stringify({
        action: 'stoptest',
      }),
    );
  }

  public async updateClass(
    class_id: string,
    name: string,
    description: string,
    concurrent: number,
    maxfails: number,
    firmware_id: string,
    beta_firmware_id?: string | null,
    alpha_firmware_id?: string | null,
  ): Promise<DeviceClass> {
    const updateClass: Partial<DeviceClass> = {
      name,
      description,
      concurrent,
      maxfails,
      firmware_id,
    };

    if (beta_firmware_id !== undefined) {
      updateClass.beta_firmware_id = beta_firmware_id;
    }

    if (alpha_firmware_id !== undefined) {
      updateClass.alpha_firmware_id = alpha_firmware_id;
    }

    const update = await this.deviceClasses.findOneAndUpdate({ class_id: class_id }, updateClass);

    if (update) {
      await this.markStableFirmware(firmware_id);
      return update;
    } else {
      throw new HttpException(404, 'Class not found');
    }
  }

  public async createFirmware(classname: string, version: string): Promise<DeviceFirmware> {
    const deviceclass = await this.deviceClasses.findOne({ name: classname });
    if (!deviceclass) {
      throw new HttpException(404, 'Class not found');
    }

    return await this.firmwares.create({
      firmware_id: uuidv4(),
      class_id: deviceclass.class_id,
      name: classname,
      version: version,
      createdAt: Date.now(),
    });
  }

  public async deleteFirmware(firmware_id: string): Promise<void> {
    await this.firmwareBinaries.deleteMany({ firmware_id: firmware_id });
    await this.firmwares.deleteOne({ firmware_id: firmware_id });
  }

  public async updateFirmwareVersion(firmware_id: string, version: string): Promise<DeviceFirmware> {
    const original = await this.firmwares.findOne({ firmware_id: firmware_id });
    if (!original) {
      throw new HttpException(404, 'Firmware not found');
    }
    // Update the firmware being edited.
    const updated = await this.firmwares.findOneAndUpdate({ firmware_id: firmware_id }, { version: version }, { new: true });
    // For each other class: propagate the new label only when the old label
    // appears exactly once within that class (unambiguous 1-to-1 match).
    const matches = await this.firmwares.find({ version: original.version, class_id: { $ne: original.class_id } });
    const byClass = new Map<string, typeof matches[number][]>();
    for (const m of matches) {
      const list = byClass.get(m.class_id) ?? [];
      list.push(m);
      byClass.set(m.class_id, list);
    }
    for (const firmwares of byClass.values()) {
      if (firmwares.length === 1) {
        await this.firmwares.updateOne({ firmware_id: firmwares[0].firmware_id }, { version: version });
      }
    }
    return updated;
  }

  public async listFirmwaresForDevice(device_id: string, user_id: string, is_demo = false): Promise<UserFirmwareList> {
    const device = await this.devices.findOne(this.deviceAccessFilter(device_id, user_id, false, is_demo), {
      class_id: 1,
      current_firmware: 1,
      'cloudSettings.pendingFirmware': 1,
      pending_firmware: 1,
    });
    if (!device) {
      throw new HttpException(404, 'Device not found or access denied');
    }

    const [device_class, firmwares] = await Promise.all([
      this.deviceClasses.findOne({ class_id: device.class_id }),
      this.firmwares.find({ class_id: device.class_id }, { _id: 0, firmware_id: 1, version: 1, createdAt: 1, wasStable: 1 }).sort({ createdAt: -1 }),
    ]);

    const stableCutoff = firmwares.filter(fw => fw.wasStable).reduce((max, fw) => Math.max(max, fw.createdAt ?? 0), -Infinity);
    const pinnedIds = new Set([device.current_firmware, this.effectivePendingFirmware(device)].filter(Boolean));
    const visible = firmwares.filter(fw => fw.wasStable || (fw.createdAt ?? 0) > stableCutoff || pinnedIds.has(fw.firmware_id));

    const channelByFirmwareId = new Map<string, FirmwareChannel[]>();
    if (device_class?.firmware_id) {
      channelByFirmwareId.set(device_class.firmware_id, ['stable']);
    }
    if (device_class?.beta_firmware_id) {
      const list = channelByFirmwareId.get(device_class.beta_firmware_id) ?? [];
      list.push('beta');
      channelByFirmwareId.set(device_class.beta_firmware_id, list);
    }
    if (device_class?.alpha_firmware_id) {
      const list = channelByFirmwareId.get(device_class.alpha_firmware_id) ?? [];
      list.push('alpha');
      channelByFirmwareId.set(device_class.alpha_firmware_id, list);
    }

    return {
      current_firmware: device.current_firmware ?? '',
      firmwares: visible.map(fw => ({
        firmware_id: fw.firmware_id,
        version: fw.version,
        createdAt: fw.createdAt,
        channels: channelByFirmwareId.get(fw.firmware_id) ?? [],
        current: fw.firmware_id === device.current_firmware,
      })),
    };
  }

  public async createFirmwareBinary(fw_id: string, name: string, data: Buffer): Promise<DeviceFirmwareBinary> {
    if (name === 'firmware.bin' && data.length > MAX_OTA_FIRMWARE_BINARY_BYTES) {
      throw new HttpException(
        413,
        `Firmware binary is ${data.length} bytes, exceeding the ${MAX_OTA_FIRMWARE_BINARY_BYTES} byte OTA partition limit`,
      );
    }

    const binary = await this.firmwareBinaries.findOneAndUpdate(
      { firmware_id: fw_id, name: name },
      {
        firmware_id: fw_id,
        name: name,
        data: data,
      },
      { new: true, upsert: true },
    );

    if (!binary) {
      throw new HttpException(500, 'Could not store firmware binary');
    }

    return binary;
  }

  public async findFirmwareByNameVersion(name: string, version: string): Promise<DeviceFirmware> {
    const firmware: DeviceFirmware = await this.firmwares.findOne(
      {
        name: name,
        version: version,
      },
      { _id: 0, firmware_id: 1, name: 1, version: 1 },
    );
    return firmware;
  }

  public async findAllFirmware(): Promise<DeviceFirmware[]> {
    const firmwares: DeviceFirmware[] = await this.firmwares.find({}, { _id: 0, firmware_id: 1, name: 1, version: 1 });
    return firmwares;
  }

  public async getFirmwareBinary(firmware_id: string, binary_name: string): Promise<Buffer> {
    const binary = await this.firmwareBinaries.findOne({ firmware_id: firmware_id, name: binary_name }, { data: 1 });

    // A device asking for a build that was deleted, or for a name that was
    // never uploaded, hears that rather than reading a 500 as a failed update.
    if (!binary) {
      throw new HttpException(404, 'Firmware binary not found');
    }

    return binary.data;
  }

  public async findOnlineDevices(): Promise<any> {
    const classes: DeviceClass[] = await this.deviceClasses.find({});

    const class_count = await Promise.all(
      classes.map(async deviceclass => {
        return {
          class: deviceclass,
          online: await this.devices.where({ lastseen: { $gte: Date.now() - ONLINE_TIMEOUT }, class_id: deviceclass.class_id }).countDocuments(),
          total: await this.devices.where({ class_id: deviceclass.class_id }).countDocuments(),
        };
      }),
    );

    return class_count;
  }

  public async getFirmwareVersions(): Promise<any> {
    const classes: DeviceClass[] = await this.deviceClasses.find({});

    const upgradetimes = await this.devices.aggregate([
      {
        $match: {
          fwupdate_end: { $type: 'number' },
        },
      },
      {
        $group: {
          _id: '$current_firmware',
          avgTime: { $avg: { $subtract: ['$fwupdate_end', '$fwupdate_start'] } },
          maxTime: { $max: { $subtract: ['$fwupdate_end', '$fwupdate_start'] } },
        },
      },
    ]);

    const class_count = await Promise.all(
      classes.map(async deviceclass => {
        const fwversions: DeviceFirmware[] = await this.firmwares.find({ class_id: deviceclass.class_id });
        const fwids = fwversions.map(fw => fw.firmware_id);

        const versions = await Promise.all(
          fwversions.map(async fwversion => {
            const upgrade_time = upgradetimes.find(el => el._id == fwversion.firmware_id);
            return {
              fw: fwversion,
              online: await this.devices
                .where({
                  lastseen: { $gte: Date.now() - ONLINE_TIMEOUT },
                  class_id: deviceclass.class_id,
                  current_firmware: fwversion.firmware_id,
                })
                .countDocuments(),
              total: await this.devices
                .where({
                  current_firmware: fwversion.firmware_id,
                  class_id: deviceclass.class_id,
                })
                .countDocuments(),
              updating: await this.devices
                .where({
                  fwupdate_start: { $gte: Date.now() - UPGRADE_TIMEOUT },
                  current_firmware: { $ne: fwversion.firmware_id },
                  class_id: deviceclass.class_id,
                  ...this.pendingFirmwareMatches(fwversion.firmware_id),
                })
                .countDocuments(),
              failed: await this.devices
                .where({
                  fwupdate_start: { $lte: Date.now() - UPGRADE_TIMEOUT },
                  current_firmware: { $ne: fwversion.firmware_id },
                  class_id: deviceclass.class_id,
                  ...this.pendingFirmwareMatches(fwversion.firmware_id),
                })
                .countDocuments(),
              avgtime: upgrade_time?.avgTime || 0,
              maxtime: upgrade_time?.maxTime || 0,
            };
          }),
        );

        versions.push({
          fw: {
            firmware_id: null,
            name: 'unknown',
            version: '0',
            class_id: deviceclass.class_id,
          },
          online: await this.devices
            .where({ lastseen: { $gte: Date.now() - ONLINE_TIMEOUT }, class_id: deviceclass.class_id, current_firmware: { $nin: fwids } })
            .countDocuments(),
          total: await this.devices.where({ current_firmware: { $not: { $in: fwids } }, class_id: deviceclass.class_id }).countDocuments(),
          updating: 0,
          failed: 0,
          avgtime: 0,
          maxtime: 0,
        });

        return {
          class: deviceclass,
          versions: versions,
        };
      }),
    );

    return class_count;
  }
}
