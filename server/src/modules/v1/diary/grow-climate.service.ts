import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { PhaseTargets } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { DataService } from '@modules/data/data.service';
import { targetsOf } from '../phase/phase-targets';
import { ClimateSummary, CLIMATE_METRICS, summariseClimate } from './week-climate';

/**
 * How a stretch of a grow was kept, read from the measurement store.
 *
 * A grow is not a device: where it stood is what its placements say, and the
 * climate of a week is whatever the controllers of those places measured. So
 * this walks from the spaces the plants were in to the devices that steer them,
 * and reads one window per device.
 *
 * **What the whole answer costs.** Two time-series reads per stretch per
 * controller, and nothing is cached. They are two because they are two
 * questions: what the air did is a mean, which is a fair answer at any width,
 * and what the lamp did is not - averaged, an output says what share of a window
 * it ran for, on a scale that differs per output. A week card of a tent with one
 * controller is two reads; a page of eight weeks is sixteen, and the second read
 * is a scan of one field that comes back with as many rows as the lamp switched.
 * The report reads one window per phase instead - five or six for a whole grow -
 * which is why it carries no week cards of its own. The reads of one page run
 * together, so the page is as slow as its slowest week rather than as the sum of
 * them.
 */

/** Narrow enough that a week is a readable curve, wide enough that a week is one query; a longer stretch widens it. */
const CLIMATE_STEP_SECONDS = 900;

/**
 * A device that steers a climate, and the targets it is running now.
 *
 * "Now" is the whole of what they are: the device document holds today's
 * configuration, so these figures say nothing about any stretch of a grow that
 * is over and are not a stand-in for a phase's own snapshot. What reads them is
 * what asks about the present - the timeline's window, and what a preset
 * application wrote.
 */
export interface Controller {
  deviceId: string;
  spaceId: string | null;
  targets: PhaseTargets | null;
}

@Injectable()
export class GrowClimateService {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    private readonly data: DataService,
  ) {}

  /**
   * The controllers standing in these spaces. A device that states no targets at
   * all - a plug, a light - is not one: a week's averages are what the tent was
   * held at, and the device that says what it was aiming for is the one that was
   * holding it there.
   *
   * A device knows only where it stands now, so a controller that has since been
   * moved out of the tent is not read for the weeks it kept.
   */
  public async controllersIn(spaceIds: readonly (string | null)[]): Promise<Controller[]> {
    const named = spaceIds.filter((id): id is string => id !== null);
    if (named.length === 0) return [];

    const rows = await this.devices.find({ spaceId: { $in: named } }, { id: 1, spaceId: 1, configuration: 1 }).lean<StoredDevice[]>();

    return rows.flatMap(device => {
      const targets = targetsOf(device.configuration);
      return targets ? [{ deviceId: device.id, spaceId: device.spaceId, targets }] : [];
    });
  }

  /**
   * One stretch, summarised. `targets` is the band the stretch is judged against
   * - the phase's own snapshot, which is the only thing that can draw a band
   * over a phase that is over, because the store holds readings and never
   * setpoints. Null is a stretch with no band, which is summarised and left
   * ungraded rather than judged against whatever a controller happens to run
   * today.
   */
  public async summarise(
    deviceIds: readonly string[],
    window: { startsAt: Date; endsAt: Date },
    targets: PhaseTargets | null,
  ): Promise<ClimateSummary> {
    const histories = await Promise.all(
      deviceIds.map(deviceId =>
        this.data.history(deviceId, { ...window, metrics: CLIMATE_METRICS, outputs: ['light'], stepSeconds: CLIMATE_STEP_SECONDS }),
      ),
    );

    return summariseClimate(histories, targets);
  }
}
