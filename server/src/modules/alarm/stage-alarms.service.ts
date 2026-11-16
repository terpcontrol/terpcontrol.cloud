import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { GrowthStage } from '@fg2/shared-types/v1';
import { repeatSecondsOf } from '@fg2/shared-types/v1-schemas';
import { StageAlarmBand, presetIdOf, stageAlarmBands, stageOfPresetId } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { StageAlarms } from '@modules/v1/phase/stage-alarms.port';
import { AlarmRuleService } from './alarm-rule.service';

/**
 * The rules a stage writes on a device, and moves when the stage changes.
 *
 * A tent in flower is watched for different things than one in veg, and the
 * bands come from the same table as the climate the stage asks for, so what a
 * rule of origin `preset` watches for is never a figure somebody typed. What a
 * person did to such a rule is theirs all the same: switching one off, giving
 * it a severity or a delivery of its own, silencing it - none of that is undone
 * by the next stage, which only moves the band, the duration and the name.
 */

/** What the rules are called where a name is shown. Stable, so a rule keeps its name when the band under it moves. */
const BAND_NAME: Readonly<Record<StageAlarmBand['key'], string>> = {
  too_hot: 'Too hot',
  too_humid: 'Too humid',
  too_cold: 'Too cold',
  co2_high: 'CO₂ too high',
};

@Injectable()
export class StageAlarmsService implements StageAlarms {
  constructor(
    @InjectModel(MODEL_V1.alarmRule) private readonly rules: Model<StoredAlarmRule>,
    private readonly ruleService: AlarmRuleService,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
  ) {}

  /**
   * One rule per band the stage implies, found again by its key, and the rules
   * of bands it does not imply removed. A stage with no climate - curing -
   * implies none, so the device is left with no stage rules at all: a rule
   * watching a flowering band over a jar is noise.
   */
  public async applyStage(deviceId: string, stage: GrowthStage, preset: string | null): Promise<void> {
    const device = await this.devices.findOne({ id: deviceId }, { type: 1 }).lean<Pick<StoredDevice, 'type'> | null>();
    const bands = (stageAlarmBands(stage, preset) ?? []).filter(band => measures(device?.type ?? null, band));
    const presetId = presetIdOf(stage, preset);

    for (const band of bands) {
      await this.rules.updateOne(
        { deviceId, origin: 'preset', presetKey: band.key },
        { $set: { name: BAND_NAME[band.key], watch: band.watch, forSeconds: band.forSeconds, presetId }, $setOnInsert: insertedOf(band) },
        { upsert: true },
      );
    }

    await this.removeStale(deviceId, bands);
  }

  /**
   * A place's thresholds follow the climate written there, whoever wrote it - a preset under Steuerung, a phase with its
   * climate, a plan step, the claim, a spell ended: every device standing in the place is watched for the bands of the
   * climate one of them was put on, a plug in the tent measuring the same air as the controller.
   */
  public async followClimate(deviceId: string, stage: GrowthStage, preset: string | null): Promise<void> {
    for (const id of await this.placeOf(deviceId)) await this.applyStage(id, stage, preset);
  }

  public dropStage(deviceId: string): Promise<void> {
    return this.removeStale(deviceId, []);
  }

  public async leaveClimate(deviceId: string): Promise<void> {
    for (const id of await this.placeOf(deviceId)) await this.dropStage(id);
  }

  public async climateHere(deviceId: string): Promise<{ stage: GrowthStage; preset: string | null } | null> {
    return this.stageOf(await this.placeOf(deviceId));
  }

  /** The device and every device standing where it stands. */
  private async placeOf(deviceId: string): Promise<string[]> {
    const device = await this.devices.findOne({ id: deviceId }, { spaceId: 1 }).lean<Pick<StoredDevice, 'spaceId'> | null>();
    const here = device?.spaceId ? await this.devices.find({ spaceId: device.spaceId }, { id: 1 }).lean<Pick<StoredDevice, 'id'>[]>() : [];
    return [...new Set([deviceId, ...here.map(one => one.id)])];
  }

  private async removeStale(deviceId: string, bands: readonly StageAlarmBand[]): Promise<void> {
    const stale = await this.rules.find({ deviceId, origin: 'preset', presetKey: { $nin: bands.map(band => band.key) } }).lean<StoredAlarmRule[]>();
    for (const rule of stale) await this.ruleService.remove(rule);
  }

  public async stageOf(deviceIds: readonly string[]): Promise<{ stage: GrowthStage; preset: string | null } | null> {
    const rules = await this.rules
      .find({ deviceId: { $in: [...deviceIds] }, origin: 'preset', presetId: { $ne: null } }, { presetId: 1 })
      .lean<Pick<StoredAlarmRule, 'presetId'>[]>();
    const counts = new Map<string, number>();
    for (const { presetId } of rules) if (presetId) counts.set(presetId, (counts.get(presetId) ?? 0) + 1);
    const most = [...counts].sort((one, other) => other[1] - one[1])[0]?.[0];
    return most ? stageOfPresetId(most) : null;
  }

  /**
   * The stage's "too humid" for a device that germinates and was asked to warn,
   * where it has none: a device set into germination from Steuerung, the
   * operating mode or a plan has the bands of whatever stage wrote them last,
   * or - never in a phase - none at all, and "Warnen, wenn es zu feucht wird"
   * would promise a warning nothing gives. Germination's own band is written,
   * which is what the phase writes. A rule that is there is left as it is,
   * switched off included: that is somebody's decision, and the alarms page
   * shows it.
   */
  public async ensureTooHumid(deviceId: string): Promise<void> {
    const band = stageAlarmBands('germination', null)?.find(one => one.key === 'too_humid');
    if (!band) return;

    await this.rules.updateOne(
      { deviceId, origin: 'preset', presetKey: band.key },
      {
        $setOnInsert: {
          ...insertedOf(band),
          name: BAND_NAME[band.key],
          watch: band.watch,
          forSeconds: band.forSeconds,
          presetId: 'germination',
        },
      },
      { upsert: true },
    );
  }
}

/**
 * Whether a device reads what a band watches: a fan and a lamp module measure temperature and humidity and no CO2
 * (`docs/device-protocol.md`, 5.4), and a rule they could never trip is a promise nothing keeps. A device not found is
 * given every band.
 */
const measures = (type: string | null, band: StageAlarmBand): boolean => !(type !== null && NO_CO2.includes(type) && band.watch.metric === 'co2');

const NO_CO2: readonly string[] = ['fan', 'light'];

/** What a stage's rule starts out with, and keeps through every later stage: whatever a person changes on it afterwards is theirs. */
const insertedOf = (band: StageAlarmBand) => ({
  id: uuidv4(),
  createdAt: new Date(),
  severity: band.severity,
  enabled: true,
  cooldownSeconds: 0,
  repeatSeconds: repeatSecondsOf(band.severity),
  delivery: { mode: 'routing', custom: null },
  silencedUntil: null,
  state: { triggered: false, lastTriggeredAt: null, lastResolvedAt: null, extremeValue: null, lastSampleAt: null },
});
