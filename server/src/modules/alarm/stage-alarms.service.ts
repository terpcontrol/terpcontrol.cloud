import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type { GrowthStage } from '@fg2/shared-types/v1';
import { StageAlarmBand, stageAlarmBands } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
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
/**
 * A critical alarm repeats until it is resolved, as the decision record has
 * it, so a tent that is too hot is said again every half hour rather than once
 * to whoever happened to hold the phone; a warning is read in the morning and
 * is said once. It is written on the rule at insert, so a person can still
 * turn a preset rule's repeat off and have it stay off through the next stage.
 */
const CRITICAL_REPEAT_SECONDS = 30 * 60;

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
  ) {}

  /**
   * One rule per band the stage implies, found again by its key, and the rules
   * of bands it does not imply removed. A stage with no climate - curing -
   * implies none, so the device is left with no stage rules at all: a rule
   * watching a flowering band over a jar is noise.
   */
  public async applyStage(deviceId: string, stage: GrowthStage, preset: string | null): Promise<void> {
    const bands = stageAlarmBands(stage, preset) ?? [];
    const presetId = preset ? `${stage}:${preset}` : stage;

    for (const band of bands) {
      await this.rules.updateOne(
        { deviceId, origin: 'preset', presetKey: band.key },
        {
          $set: { name: BAND_NAME[band.key], watch: band.watch, forSeconds: band.forSeconds, presetId },
          $setOnInsert: {
            id: uuidv4(),
            createdAt: new Date(),
            severity: band.severity,
            enabled: true,
            cooldownSeconds: 0,
            repeatSeconds: band.severity === 'critical' ? CRITICAL_REPEAT_SECONDS : 0,
            delivery: { mode: 'routing', custom: null },
            silencedUntil: null,
            state: { triggered: false, lastTriggeredAt: null, lastResolvedAt: null, extremeValue: null, lastSampleAt: null },
          },
        },
        { upsert: true },
      );
    }

    const stale = await this.rules.find({ deviceId, origin: 'preset', presetKey: { $nin: bands.map(band => band.key) } }).lean<StoredAlarmRule[]>();
    for (const rule of stale) await this.ruleService.remove(rule);
  }
}
