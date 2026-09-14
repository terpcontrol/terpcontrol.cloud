import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Recipe, RecipeStep } from '@fg2/shared-types';
import { InjectModel } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';
import { Device, RecipeTemplate } from '@fg2/shared-types';
import { logger } from '@utils/logger';
import { BackgroundWork } from '../../common/background-work';
import { MODEL } from '../../database/models.module';
import { MailService } from '../mail/mail.service';
import { DeviceLogService } from './device-log.service';
import { DeviceSettingsService } from './device-settings.service';

/** How long a step's unit is worth, as the multiple of a minute the plan stores. */
const STEP_DURATION_UNIT_MINUTES = { weeks: 7 * 24 * 60, days: 24 * 60, hours: 60 } as const;

/** A step is re-sent at most once an hour, and only to a device that is answering. */
const STEP_REAPPLY_INTERVAL_MS = 60 * 60 * 1000;
const STEP_APPLY_LASTSEEN_MS = 60 * 1000;

export interface RecipePayload extends Partial<Recipe> {
  steps?: RecipeStep[];
  additionalInfo?: boolean;
}

export interface RecipeTemplatePayload {
  name?: string;
  steps?: RecipeStep[];
  public?: boolean;
}

/** The grow plans: the steps stored for a device, and the loop that walks them. */
@Injectable()
export class DeviceRecipeService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    @InjectModel(MODEL.recipeTemplate) private readonly templates: Model<RecipeTemplate & Document>,
    private readonly logs: DeviceLogService,
    private readonly settings: DeviceSettingsService,
    private readonly mail: MailService,
  ) {}

  /** The loop used to start as this file was imported, before the database was necessarily up. */
  public onModuleInit(): void {
    this.work.repeat('The grow plans', () => this.runRecipes(), 20000);
  }

  public onApplicationShutdown(): void {
    this.work.stop();
  }

  /** One pass over every device with a running plan. */
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
        await this.runRecipe(device, now);
      } catch (error) {
        logger.error(`Failed running the grow plan of device ${device.device_id}: ${error}`);
      }
    }
  }

  private async runRecipe(device: Device, now: number) {
    if (device.recipe.activeStepIndex >= device.recipe.steps.length || (device.recipe.activeStepIndex ?? -1) < 0) {
      return;
    }

    let activeStep = device.recipe.steps[device.recipe.activeStepIndex];
    let hasChanges = false;
    let emailSubject = null;
    let emailBody = null;

    const elapsedMs = now - device.recipe.activeSince;
    const stepDurationMs = activeStep.duration * 60 * 1000 * (STEP_DURATION_UNIT_MINUTES[activeStep.durationUnit] ?? 1);
    const remainingMs = stepDurationMs - elapsedMs;
    if (remainingMs <= 0) {
      if (activeStep.waitForConfirmation) {
        if (device.recipe.notifications !== 'off' && !activeStep.notified) {
          emailSubject = `[TERP CONTROL] Recipe step #${device.recipe.activeStepIndex + 1} waiting for confirmation on device ${device.device_id}`;
          emailBody = `Please confirm the completion of step #${device.recipe.activeStepIndex + 1} ${activeStep.name}: ${
            activeStep.confirmationMessage || 'No additional information provided.'
          }`;

          if (device.recipe.additionalInfo) {
            await this.logs.logMessage(device.device_id, {
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
            await this.logs.logMessage(device.device_id, {
              title: 'message-recipe-advanced',
              message: `message-recipe-advanced:${device.recipe.activeStepIndex + 1} (${activeStep.name ?? ''})`,
              severity: 0,
              categories: ['recipe', 'recipe-step'],
            });
          }

          if (activeStep.stage) {
            await this.logs.logStageTransitionIfChanged(device.device_id, activeStep.stage);
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
            await this.logs.logMessage(device.device_id, {
              title: 'message-recipe-looped',
              message: `message-recipe-looped:${activeStep.name ?? ''}`,
              severity: 0,
              categories: ['recipe', 'recipe-step', 'recipe-looped'],
            });
          }

          if (activeStep.stage) {
            await this.logs.logStageTransitionIfChanged(device.device_id, activeStep.stage);
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
            await this.logs.logMessage(device.device_id, {
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
      !!activeStep &&
      (!activeStep.lastTimeApplied || activeStep.lastTimeApplied < now - STEP_REAPPLY_INTERVAL_MS) &&
      device.lastseen >= now - STEP_APPLY_LASTSEEN_MS;
    if (applyStep) {
      // Its own catch: sending the step can fail, and the advance it belongs
      // to has already been stored - so the mail below, which is only ever
      // sent on the pass that advanced, must not be skipped with it.
      try {
        if (await this.settings.configureDevice(device.device_id, activeStep.settings)) {
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
  }

  public async forDevice(deviceId: string): Promise<Recipe> {
    const device = await this.devices.findOne({ device_id: deviceId }).select('recipe').lean().exec();
    return (device?.recipe ?? { steps: [], activeStepIndex: 0, activeSince: 0 }) as Recipe;
  }

  /**
   * Stores the plan and treats starting it, or activating a step by hand, as a
   * stage transition for the grow diary - the same way an automatic advance is
   * recorded.
   */
  public async save(deviceId: string, payload: RecipePayload): Promise<void> {
    const previous = ((await this.devices.findOne({ device_id: deviceId }).select('recipe'))?.recipe ?? {}) as Partial<Recipe>;
    const activeStepChanged = previous?.activeStepIndex !== payload?.activeStepIndex || previous?.activeSince !== payload?.activeSince;

    for (let index = 0; index < (payload.steps?.length || 0); index++) {
      if (index !== payload.activeStepIndex || activeStepChanged) {
        payload.steps[index].notified = false;
      }
      payload.steps[index].lastTimeApplied = 0;
    }

    if (activeStepChanged && payload?.activeStepIndex != null && !isNaN(payload.activeStepIndex) && payload?.additionalInfo) {
      await this.logs.logMessage(deviceId, {
        title: 'message-recipe-step-manually-activated',
        message: `message-recipe-step-manually-activated:${payload.activeStepIndex + 1} (${payload.steps?.[payload.activeStepIndex]?.name ?? ''})`,
        severity: 0,
        categories: ['recipe'],
        deleted: true,
      });
    }

    const manuallyActivatedStage = payload?.steps?.[payload?.activeStepIndex]?.stage;
    if (activeStepChanged && payload?.activeSince > 0 && manuallyActivatedStage) {
      await this.logs.logStageTransitionIfChanged(deviceId, manuallyActivatedStage);
    }

    const updated = await this.devices.findOneAndUpdate({ device_id: deviceId }, { $set: { recipe: payload } }, { new: true });
    if (!updated) {
      throw new NotFoundException({ error: 'Device not found' });
    }
  }

  /** Templates the caller may see: the public ones plus their own. */
  public listTemplates(userId: string) {
    return this.templates
      .find({ $or: [{ public: true }, { owner_id: userId }] })
      .lean()
      .exec();
  }

  public async createTemplate(userId: string, payload: RecipeTemplatePayload) {
    if (!payload?.name || !payload?.steps) {
      throw new BadRequestException({ error: 'Missing name or steps' });
    }

    if (await this.templates.findOne({ name: payload.name }).lean().exec()) {
      throw new ConflictException({ error: 'Template name already exists' });
    }

    return this.templates.create({ name: payload.name, owner_id: userId, public: !!payload.public, steps: payload.steps });
  }

  public async readTemplate(user: { userId: string; isAdmin: boolean }, templateId: string) {
    const template = await this.templates.findById(templateId).lean().exec();
    if (!template) {
      throw new NotFoundException({ error: 'Not found' });
    }

    if (!template.public && template.owner_id !== user.userId && !user.isAdmin) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    return template;
  }

  public async updateTemplate(user: { userId: string; isAdmin: boolean }, templateId: string, payload: RecipeTemplatePayload = {}) {
    const template = await this.templates.findById(templateId).exec();
    if (!template) {
      throw new NotFoundException({ error: 'Not found' });
    }

    if (template.owner_id !== user.userId && !user.isAdmin) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    if (payload?.name && payload.name !== template.name) {
      const clash = await this.templates
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
    const template = await this.templates.findById(templateId).exec();
    if (!template) {
      throw new NotFoundException({ error: 'Not found' });
    }

    if (template.owner_id !== user.userId && !user.isAdmin) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    await this.templates.findByIdAndDelete(templateId).exec();
  }
}
