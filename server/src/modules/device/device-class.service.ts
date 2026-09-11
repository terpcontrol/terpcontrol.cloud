import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Device, DeviceClass, DeviceFirmware } from '@fg2/shared-types';
import { HttpException } from '@common/http-exception';
import { BackgroundWork } from '../../common/background-work';
import { MODEL } from '../../database/models.module';
import { ONLINE_TIMEOUT } from './device.queries';

/** The device types this server knows, and the firmware each channel points at. */
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

@Injectable()
export class DeviceClassService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    @InjectModel(MODEL.deviceClass) private readonly deviceClasses: Model<DeviceClass & Document>,
    @InjectModel(MODEL.deviceFirmware) private readonly firmwares: Model<DeviceFirmware & Document>,
  ) {}

  /**
   * The classes are seeded rather than migrated in, and this used to run as the
   * file was imported - writing to the database before anything had connected
   * to it.
   */
  public onModuleInit(): void {
    this.work.run('Creating the device classes', () => this.checkDeviceClasses());
  }

  public onApplicationShutdown(): void {
    this.work.stop();
  }

  private async checkDeviceClasses() {
    for (const device_class of minimal_classes) {
      const class_data = await this.findClass(device_class.name);
      if (!class_data) {
        await this.createClass(device_class.name, device_class.description, device_class.concurrent, device_class.maxfails, '');
      }
    }
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

  /**
   * A build a class has pointed its stable channel at stays offerable for good:
   * the firmware list hides older builds, and one that was shipped is not one
   * of them.
   */
  private async markStableFirmware(firmware_id: string | undefined) {
    if (!firmware_id) {
      return;
    }
    await this.firmwares.updateOne({ firmware_id: firmware_id }, { $set: { wasStable: true } });
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
}
