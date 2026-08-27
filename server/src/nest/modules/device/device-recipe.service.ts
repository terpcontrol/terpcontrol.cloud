import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Recipe, RecipeStep } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import recipeModel from '@models/recipe.model';
import { deviceService } from '@services/device.service';

export interface RecipePayload extends Partial<Recipe> {
  steps?: RecipeStep[];
  additionalInfo?: boolean;
}

export interface RecipeTemplatePayload {
  name?: string;
  steps?: RecipeStep[];
  public?: boolean;
}

@Injectable()
export class DeviceRecipeService {
  public async forDevice(deviceId: string): Promise<Recipe> {
    const device = await deviceModel.findOne({ device_id: deviceId }).select('recipe').lean().exec();
    return (device?.recipe ?? { steps: [], activeStepIndex: 0, activeSince: 0 }) as Recipe;
  }

  /**
   * Stores the plan and treats starting it, or activating a step by hand, as a
   * stage transition for the grow diary - the same way an automatic advance is
   * recorded.
   */
  public async save(deviceId: string, payload: RecipePayload): Promise<void> {
    const previous = ((await deviceModel.findOne({ device_id: deviceId }).select('recipe'))?.recipe ?? {}) as Partial<Recipe>;
    const activeStepChanged = previous?.activeStepIndex !== payload?.activeStepIndex || previous?.activeSince !== payload?.activeSince;

    for (let index = 0; index < (payload.steps?.length || 0); index++) {
      if (index !== payload.activeStepIndex || activeStepChanged) {
        payload.steps[index].notified = false;
      }
      payload.steps[index].lastTimeApplied = 0;
    }

    if (activeStepChanged && payload?.activeStepIndex != null && !isNaN(payload.activeStepIndex) && payload?.additionalInfo) {
      await deviceService.logMessage(deviceId, {
        title: 'message-recipe-step-manually-activated',
        message: `message-recipe-step-manually-activated:${payload.activeStepIndex + 1} (${payload.steps?.[payload.activeStepIndex]?.name ?? ''})`,
        severity: 0,
        categories: ['recipe'],
        deleted: true,
      });
    }

    const manuallyActivatedStage = payload?.steps?.[payload?.activeStepIndex]?.stage;
    if (activeStepChanged && payload?.activeSince > 0 && manuallyActivatedStage) {
      await deviceService.logStageTransitionIfChanged(deviceId, manuallyActivatedStage);
    }

    const updated = await deviceModel.findOneAndUpdate({ device_id: deviceId }, { $set: { recipe: payload } }, { new: true });
    if (!updated) {
      throw new NotFoundException({ error: 'Device not found' });
    }
  }

  /** Templates the caller may see: the public ones plus their own. */
  public listTemplates(userId: string) {
    return recipeModel
      .find({ $or: [{ public: true }, { owner_id: userId }] })
      .lean()
      .exec();
  }

  public async createTemplate(userId: string, payload: RecipeTemplatePayload) {
    if (!payload?.name || !payload?.steps) {
      throw new BadRequestException({ error: 'Missing name or steps' });
    }

    if (await recipeModel.findOne({ name: payload.name }).lean().exec()) {
      throw new ConflictException({ error: 'Template name already exists' });
    }

    return recipeModel.create({ name: payload.name, owner_id: userId, public: !!payload.public, steps: payload.steps });
  }

  public async readTemplate(user: { userId: string; isAdmin: boolean }, templateId: string) {
    const template = await recipeModel.findById(templateId).lean().exec();
    if (!template) {
      throw new NotFoundException({ error: 'Not found' });
    }

    if (!template.public && template.owner_id !== user.userId && !user.isAdmin) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    return template;
  }

  public async updateTemplate(user: { userId: string; isAdmin: boolean }, templateId: string, payload: RecipeTemplatePayload = {}) {
    const template = await recipeModel.findById(templateId).exec();
    if (!template) {
      throw new NotFoundException({ error: 'Not found' });
    }

    if (template.owner_id !== user.userId && !user.isAdmin) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    if (payload?.name && payload.name !== template.name) {
      const clash = await recipeModel
        .findOne({ name: payload.name, _id: { $ne: templateId } })
        .lean()
        .exec();
      if (clash) {
        throw new ConflictException({ error: 'Template name already exists' });
      }
      template.name = payload.name;
    }

    if (payload?.steps && Array.isArray(payload.steps)) template.steps = payload.steps;
    if (typeof payload?.public !== 'undefined') template.public = !!payload.public;

    await template.save();
    return template;
  }

  public async deleteTemplate(user: { userId: string; isAdmin: boolean }, templateId: string): Promise<void> {
    const template = await recipeModel.findById(templateId).exec();
    if (!template) {
      throw new NotFoundException({ error: 'Not found' });
    }

    if (template.owner_id !== user.userId && !user.isAdmin) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    await recipeModel.findByIdAndDelete(templateId).exec();
  }
}
