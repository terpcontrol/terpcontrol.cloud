import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HttpException } from '@common/http-exception';
import { MODEL_V1 } from '@database/models';
import { StoredFirmwareBinary } from '@database/schemas/v1/firmware-binaries.schema';

/** The bytes OTA streams into the device's update partition. */
@Injectable()
export class FirmwareImageService {
  constructor(@InjectModel(MODEL_V1.firmwareBinary) private readonly binaries: Model<StoredFirmwareBinary>) {}

  /**
   * One file of one build, by the name the device asks for. The bytes are held
   * back from every other read, so this one asks for them.
   *
   * A device asking for a build that was deleted, or for a name that was never
   * uploaded, hears that rather than reading a 500 as a failed update.
   */
  public async read(firmwareId: string, name: string): Promise<Buffer> {
    const binary = await this.binaries.findOne({ firmwareId, name }).select('+data');

    if (!binary) {
      throw new HttpException(404, 'Firmware binary not found');
    }

    return binary.data;
  }
}
