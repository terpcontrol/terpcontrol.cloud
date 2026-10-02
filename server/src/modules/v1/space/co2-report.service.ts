import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Co2Report } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { DataService } from '@modules/data/data.service';
import { cylindersOf, REFILL_READINGS, refillsOf, reportOf } from './co2-report';

/** The hardware that doses CO2 itself: a fridge module and a tent controller, each with a valve beside its sensor. */
const DOSING = ['fridge', 'controller'];

/**
 * The CO2 report of a place: the refills written down here, and the openings
 * counted by every device standing here that doses CO2 - the place's own
 * hardware today, which is the hardware the cylinders are on.
 */
@Injectable()
export class Co2ReportService {
  constructor(
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    private readonly data: DataService,
  ) {}

  public async reportOf(spaceId: string, now: Date = new Date()): Promise<Co2Report> {
    const lines = await this.entries
      .find({ spaceId, 'values.readings.key': { $in: [...REFILL_READINGS] } }, { occurredAt: 1, values: 1 })
      .lean<Pick<EntryDocument, 'occurredAt' | 'values'>[]>();
    const cylinders = cylindersOf(refillsOf(lines));
    if (cylinders.length === 0) return { cylinders: [], openingsPerGram: null, restGrams: null };

    // A controller without a sensor reports no valve either: the firmware
    // writes the same "there is none" for both.
    const dosing = await this.devices.find({ spaceId, type: { $in: DOSING } }, { id: 1, 'state.hardware': 1 }).lean<StoredDevice[]>();
    const ids = dosing.filter(device => device.state?.hardware?.co2 !== 'off').map(device => device.id);

    const counted = await Promise.all(
      cylinders.map(async cylinder => {
        const window = { startsAt: cylinder.since, endsAt: cylinder.until ?? now };
        const each = await Promise.all(ids.map(id => this.data.valveOpenings(id, window)));
        return { ...cylinder, openings: each.reduce((sum, openings) => sum + openings, 0) };
      }),
    );

    return reportOf(counted);
  }
}
