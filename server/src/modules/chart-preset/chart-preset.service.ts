import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { ChartPreset } from '@fg2/shared-types';
import { MODEL } from '../../database/models.module';
import { CreateChartPreset } from './chart-preset.schemas';

const MAX_PRESETS_PER_USER = 50;
const MAX_DEVICE_TYPE_LENGTH = 40;

@Injectable()
export class ChartPresetService {
  constructor(@InjectModel(MODEL.chartPreset) private readonly presets: Model<ChartPreset & Document>) {}

  public list(ownerId: string) {
    return this.presets.find({ owner_id: ownerId }).sort({ createdAt: -1 }).lean().exec();
  }

  public async create(ownerId: string, preset: CreateChartPreset) {
    const count = await this.presets.countDocuments({ owner_id: ownerId });
    if (count >= MAX_PRESETS_PER_USER) {
      throw new BadRequestException({ error: `Preset limit of ${MAX_PRESETS_PER_USER} reached` });
    }

    return this.presets.create({
      preset_id: randomBytes(12).toString('base64url'),
      owner_id: ownerId,
      name: preset.name.trim(),
      device_type: preset.device_type?.slice(0, MAX_DEVICE_TYPE_LENGTH),
      query: preset.query,
      createdAt: Date.now(),
    });
  }

  public async remove(ownerId: string, presetId: string): Promise<void> {
    const result = await this.presets.deleteOne({ preset_id: presetId, owner_id: ownerId });

    if (result.deletedCount === 0) {
      throw new NotFoundException({ error: 'Chart preset not found' });
    }
  }
}
