import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ShareService, currentShareToken } from './share.service';
import { ApiClient } from '../api/api.client';
import { api, AuxCommandOptions, DiaryEntryInput, TestOutputs } from '../api/api.routes';
import type {
  Alarm,
  CloudSettings,
  DeviceAccessInfo,
  DeviceClassRollout,
  DeviceLog,
  Recipe,
  Device,
  DeviceListEntry,
  UserFirmwareList,
} from '@fg2/shared-types';

/** A row of the device listing, with its configuration blob parsed for the templates. */
export type DeviceWithParsedSettings = DeviceListEntry & {
  settings?: any;
};

/** The whole record the serial-number lookup answers with, parsed the same way. */
export type DeviceRecordWithParsedSettings = Device & {
  settings?: any;
};

export const device_types = ['climatesensor', 'climatesensorpro'];

export type DevicesLoadState = 'loading' | 'loaded' | 'error';


@Injectable({
  providedIn: 'root'
})
export class DeviceAdminService {

  private created_devices : DeviceWithParsedSettings[] = [];
  public device_classes: BehaviorSubject<DeviceClassRollout[]> = new BehaviorSubject<DeviceClassRollout[]>([]);

  constructor(private client: ApiClient, private auth: AuthService) {
    this.auth.current_user.subscribe(async (user) => {
      if(user) {
        //setInterval(() => {
        //  this.fetch();
        //}, 10000)
        this.fetch();
      }
      else {
        this.device_classes.next([]);
      }
    })
  }

  public async fetch() {
    this.device_classes.next(await this.client.fetch(api.fleet.rollouts()))
  }

  public async createClass(name:string, description: string, concurrent: number, maxfails: number, firmware_id:string) {
    await this.client.fetch(api.fleet.createClass({
      name,
      description,
      concurrent: parseInt(concurrent + ''),
      maxfails: parseInt(maxfails + ''),
      firmware_id,
      beta_firmware_id: firmware_id,
      alpha_firmware_id: firmware_id,
    }));
  }

  public async updateClass(
    class_id: string,
    name:string,
    description: string,
    concurrent: number,
    maxfails: number,
    firmware_id:string,
    beta_firmware_id:string,
    alpha_firmware_id:string,
  ) {
    await this.client.fetch(api.fleet.updateClass(class_id, {
      name,
      description,
      concurrent: parseInt(concurrent + ''),
      maxfails: parseInt(maxfails + ''),
      firmware_id,
      beta_firmware_id,
      alpha_firmware_id,
    }));
  }

  public async deleteFirmware(firmware_id:string) {
    return await this.client.fetch(api.fleet.deleteFirmware(firmware_id));
  }

  public async updateFirmwareVersion(firmware_id:string, version:string) {
    return await this.client.fetch(api.fleet.relabelFirmware(firmware_id, version));
  }

  public async createFirmware(file:File, name:string, version:string) {
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("name", name);
    formData.append("version", version);
    return await this.client.fetch(api.fleet.createFirmware(formData));
  }
}

@Injectable({
  providedIn: 'root'
})
export class DeviceService {

  public settingsChanged = new Subject<{device_id: string, settings: any}>();

  public devices: BehaviorSubject<DeviceWithParsedSettings[]> = new BehaviorSubject<DeviceWithParsedSettings[]>([]);
  // An empty list means "this account owns nothing"; a failed fetch means "we don't
  // know". Collapsing both into an empty list is what made a rejected token look like
  // an empty account.
  public loadState: BehaviorSubject<DevicesLoadState> = new BehaviorSubject<DevicesLoadState>('loading');

  constructor(private client: ApiClient, private auth: AuthService, private shares: ShareService) {
    this.fetchDevices();
  }

  fetchDevices() {
    this.auth.current_user.subscribe(() => this.refetchDevices());
  }

  public async refetchDevices() {
    if (!this.auth.authenticated.getValue()) {
      this.devices.next([]);
      this.loadState.next('loading');
      return;
    }

    try {
      const devices: DeviceWithParsedSettings[] = await this.client.fetch(api.devices.mine())
      for(let device of devices) {
        try {
          device.settings = JSON.parse(device.configuration);
        }
        catch(err) {
          device.settings = {};
        }
      }
      this.devices.next(devices);
      this.loadState.next('loaded');
    } catch(e) {
      console.log('Failed fetching devices', e);
      // Keep whatever was on screen: a failed refresh should not blank a working list.
      this.loadState.next('error');
    }
  }

  public async claim(claim_code:string): Promise<DeviceWithParsedSettings | undefined> {
    const result = await this.client.fetch(api.devices.claim(claim_code))
    await this.refetchDevices();
    return this.devices.getValue().find(device => device.device_id === result?.device_id);
  }

  public async unclaim(device_id:string) {
    await this.client.fetch(api.devices.unclaim(device_id))
    await this.refetchDevices();
  }

  /**
   * Fire-and-forget command about a device-managed auxiliary (e.g. removing,
   * testing or re-configuring a paired smart socket). The device confirms by
   * re-reporting its hardware info, so callers should refetch devices
   * afterwards.
   *
   * `slot` addresses one socket of a role; without it the command applies to
   * the role as a whole (and socket_set adds one when the role has none).
   */
  public async sendAuxCommand(
    device_id: string,
    action: 'socket_remove' | 'socket_test' | 'socket_set',
    role: string,
    options?: AuxCommandOptions,
  ) {
    await this.client.fetch(api.devices.auxCommand(device_id, action, role, options));
  }

  public async getConfig(device_id:string) {
    return await this.client.fetch(api.devices.configuration(device_id))
  }

  public async getAlarms(device_id:string) {
    return await this.client.fetch(api.devices.alarms(device_id))
  }

  public async getCloudSettings(device_id:string): Promise<CloudSettings> {
    return (await this.getDeviceAccessInfo(device_id)).cloudSettings;
  }

  public async getDeviceAccessInfo(device_id: string): Promise<DeviceAccessInfo> {
    return await this.client.fetch(api.devices.accessInfo(device_id));
  }

  public async resolveDeviceAccessInfo(device_id: string): Promise<DeviceAccessInfo> {
    const ownedDevice = this.devices.getValue().find(device => device.device_id === device_id);

    if (ownedDevice) {
      return {
        device_id: ownedDevice.device_id,
        device_type: ownedDevice.device_type,
        name: ownedDevice.name,
        isPublic: false,
        cloudSettings: ownedDevice.cloudSettings ?? {},
      };
    }

    const shareToken = currentShareToken();

    try {
      return await this.getDeviceAccessInfo(device_id);
    } catch (error) {
      // Not the owner: the page must have been opened through a share link.
      if (shareToken) {
        const accessInfo = await this.shares.resolve(shareToken);
        if (accessInfo.device_id === device_id) {
          return accessInfo;
        }
      }
      throw error;
    }
  }

  // A device that was never given a plan answers with an empty one.
  public async getRecipe(device_id:string): Promise<Recipe> {
    return await this.client.fetch(api.devices.recipe(device_id))
  }

  public async setRecipe(device_id:string, recipe: Recipe) {
    await this.client.fetch(api.devices.setRecipe(device_id, recipe));
  }

  public async getLogs(device_id:string, timestampFrom?: number, timestampTo?: number, deleted?: boolean, categories?: string[]): Promise<DeviceLog[]> {
    const result = await this.client.fetch(api.diary.list(device_id, { from: timestampFrom, to: timestampTo, deleted, categories }));
    return result?.map(log => ({ ...log, time: new Date(log.time) })) ?? [];
  }

  public async getDeviceImageUrl(device_id: string, format: 'mp4' | 'jpeg' | 'user/jpeg', timestamp?: number, duration?: string, imageId?: string): Promise<string> {
    // Without a timestamp or an id, the URL names the current five-second slot,
    // which is what keeps the browser from serving a still out of its cache.
    return this.client.url(api.images.source(device_id, {
      format,
      timestamp: timestamp ?? (imageId ? undefined : Math.ceil(Date.now() / 5000) * 5000),
      duration,
      image_id: imageId,
      token: await this.auth.getImageToken() ?? undefined,
      share: currentShareToken() ?? undefined,
    }));
  }

  public async testWebcamStream(device_id: string, settings: { rtspStream: string; rtspStreamTransport?: string; tunnelRtspStream?: boolean }): Promise<Blob> {
    return await this.client.fetch(api.images.testStream(device_id, settings));
  }

  public async uploadDeviceImage(device_id: string, file: File, timestamp?: number): Promise<string> {
    const formData = new FormData();
    formData.append('image', file, file.name);
    if (Number.isFinite(timestamp)) {
      formData.append('timestamp', String(timestamp));
    }

    const result = await this.client.fetch(api.images.upload(device_id, formData));
    return result.image_id;
  }

  public async clearLogs(device_id:string) {
    return await this.client.fetch(api.diary.clear(device_id))
  }

  public async addLog(device_id: string, message: DiaryEntryInput) {
    await this.client.fetch(api.diary.add(device_id, message))
  }

  public async updateLog(device_id: string, log_id: string, payload: DiaryEntryInput) {
    await this.client.fetch(api.diary.update(device_id, log_id, payload));
  }

  public async deleteLog(device_id: string, log_id: string) {
    await this.client.fetch(api.diary.remove(device_id, log_id));
  }

  public async setSettings(device_id:string, settings: string) {
    await this.client.fetch(api.devices.configure(device_id, settings));
    // Notify subscribers that settings for this device have changed
    this.settingsChanged.next({ device_id, settings });
  }

  public async setAlarms(device_id: string, alarms: Alarm[]) {
    await this.client.fetch(api.devices.setAlarms(device_id, alarms));
  }

  public async setCloudSettings(device_id: string, cloudSettings: CloudSettings) {
    await this.client.fetch(api.devices.setCloudSettings(device_id, cloudSettings));
  }

  public async listFirmwares(device_id: string): Promise<UserFirmwareList> {
    return await this.client.fetch(api.devices.firmwares(device_id));
  }

  public async setName(device_id:string, name: string) {
    await this.client.fetch(api.devices.setName(device_id, name))
  }

  public async testOutputs(device_id: string, outputs: TestOutputs) {
    await this.client.fetch(api.devices.test(device_id, outputs));
  }

  public async stopTest(device_id: string) {
    await this.client.fetch(api.devices.stopTest(device_id));
  }

  public async getBySerial(serialnumber: string) : Promise<DeviceRecordWithParsedSettings> {
    const device: DeviceRecordWithParsedSettings = await this.client.fetch(api.devices.bySerial(serialnumber));
    try {
      device.settings = device.configuration ? JSON.parse(device.configuration) : {};
    } catch(err) {
      device.settings = {};
    }
    return device;
  }

  public async activateMaintenanceMode(device_id: string, durationMinutes: number) {
    await this.client.fetch(api.devices.maintenanceMode(device_id, durationMinutes));
  }

  public async rebootDevice(device_id: string) {
    await this.client.fetch(api.devices.reboot(device_id));
  }
}
