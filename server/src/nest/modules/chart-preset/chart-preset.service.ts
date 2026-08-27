import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import chartPresetModel from '@models/chartpreset.model';
import { CreateChartPreset } from './chart-preset.schemas';

const MAX_PRESETS_PER_USER = 50;
const MAX_DEVICE_TYPE_LENGTH = 40;

@Injectable()
export class ChartPresetService {
  public list(ownerId: string) {
    return chartPresetModel.find({ owner_id: ownerId }).sort({ createdAt: -1 }).lean().exec();
  }

  public async create(ownerId: string, preset: CreateChartPreset) {
    const count = await chartPresetModel.countDocuments({ owner_id: ownerId });
    if (count >= MAX_PRESETS_PER_USER) {
      throw new BadRequestException({ error: `Preset limit of ${MAX_PRESETS_PER_USER} reached` });
    }

    return chartPresetModel.create({
      preset_id: randomBytes(12).toString('base64url'),
      owner_id: ownerId,
      name: preset.name.trim(),
      device_type: preset.device_type?.slice(0, MAX_DEVICE_TYPE_LENGTH),
      query: preset.query,
      createdAt: Date.now(),
    });
  }

  public async remove(ownerId: string, presetId: string): Promise<void> {
    const result = await chartPresetModel.deleteOne({ preset_id: presetId, owner_id: ownerId });

    if (result.deletedCount === 0) {
      throw new NotFoundException({ error: 'Chart preset not found' });
    }
  }
}
