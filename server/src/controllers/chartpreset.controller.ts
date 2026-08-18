import { NextFunction, Response } from 'express';
import { randomBytes } from 'crypto';
import { RequestWithUser } from '@/interfaces/auth.interface';
import chartPresetModel from '@/models/chartpreset.model';

const MAX_PRESETS_PER_USER = 50;
const MAX_NAME_LENGTH = 60;
const MAX_QUERY_LENGTH = 2000;

class ChartPresetController {
  public list = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const presets = await chartPresetModel.find({ owner_id: req.user_id }).sort({ createdAt: -1 }).lean().exec();
      res.status(200).json(presets);
    } catch (error) {
      next(error);
    }
  };

  public create = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const { name, query, device_type } = req.body ?? {};

      if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `name is required (max ${MAX_NAME_LENGTH} characters)` });
      }
      if (typeof query !== 'string' || !query || query.length > MAX_QUERY_LENGTH) {
        return res.status(400).json({ error: `query is required (max ${MAX_QUERY_LENGTH} characters)` });
      }

      const count = await chartPresetModel.countDocuments({ owner_id: req.user_id });
      if (count >= MAX_PRESETS_PER_USER) {
        return res.status(400).json({ error: `Preset limit of ${MAX_PRESETS_PER_USER} reached` });
      }

      const preset = await chartPresetModel.create({
        preset_id: randomBytes(12).toString('base64url'),
        owner_id: req.user_id,
        name: name.trim(),
        device_type: typeof device_type === 'string' ? device_type.slice(0, 40) : undefined,
        query,
        createdAt: Date.now(),
      });

      res.status(201).json(preset);
    } catch (error) {
      next(error);
    }
  };

  public remove = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      const result = await chartPresetModel.deleteOne({ preset_id: req.params.preset_id, owner_id: req.user_id });

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Chart preset not found' });
      }

      res.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  };
}

export default ChartPresetController;
