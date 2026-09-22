import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { PlanStep } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredPlan } from '@database/schemas/v1/plans.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { PlanAnnouncer } from '@modules/v1/plan/plan-announcer.port';
import { planAnnouncement } from './notification-messages';
import { NotificationService } from './notification.service';
import { RecipientsService } from './recipients.service';

/**
 * The plan's side of the routing grid.
 *
 * A plan already has a delivery of its own - an address written on the recipe,
 * which predates anybody's notification settings and is untouched. This is the
 * other half: the people who keep the tent, each told on the channels they
 * themselves asked for. That is why it is the tent rather than the device that
 * the message names, and why the plan's own address is not written to from here.
 */
@Injectable()
export class PlanAnnouncerService implements PlanAnnouncer {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    private readonly notifications: NotificationService,
    private readonly recipients: RecipientsService,
  ) {}

  public async askedToConfirm(plan: StoredPlan, step: PlanStep): Promise<void> {
    const message = planAnnouncement(plan, step, await this.tentOf(plan.deviceId));

    for (const userId of await this.recipients.forDevice(plan.deviceId)) await this.notifications.tellOnce(userId, message);
  }

  /** What the place is called. A controller standing in no tent is named by the only name it has. */
  private async tentOf(deviceId: string): Promise<string> {
    const device = await this.devices.findOne({ id: deviceId }, { spaceId: 1 }).lean<Pick<StoredDevice, 'spaceId'>>();
    const space = device?.spaceId ? await this.spaces.findOne({ id: device.spaceId }, { name: 1 }).lean<Pick<SpaceDocument, 'name'>>() : null;

    return space?.name ?? `Device ${deviceId}`;
  }
}
