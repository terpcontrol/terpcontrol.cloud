import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AlarmRuleCreate, AlarmRuleUpdate, AlarmWatch } from '@fg2/shared-types/v1';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { CursorPage, afterCursor, pageOf, readLimit } from '@common/v1/pages';
import { PageQuery } from '@common/v1/validation';
import { conflict, notFound } from '@common/v1/problem';
import { watchedName } from './alarm.watch';

/**
 * What a person does to their rules. The engine's half of a rule - everything
 * under `state` - is never written here: a client says what to watch for, and
 * where the watching has got to is the server's alone.
 */

@Injectable()
export class AlarmRuleService {
  constructor(
    @InjectModel(MODEL_V1.alarmRule) private readonly rules: Model<StoredAlarmRule>,
    @InjectModel(MODEL_V1.alert) private readonly alerts: Model<StoredAlert>,
  ) {}

  public async list(deviceId: string, query: PageQuery, limit: number): Promise<CursorPage<StoredAlarmRule>> {
    const rows = await this.rules
      .find({ deviceId, ...afterCursor('createdAt', query.cursor) })
      .sort({ createdAt: -1, id: -1 })
      .limit(readLimit(limit))
      .lean<StoredAlarmRule[]>();

    return pageOf(rows, limit, rule => ({ at: rule.createdAt, id: rule.id }));
  }

  public async byId(id: string): Promise<StoredAlarmRule> {
    const rule = await this.rules.findOne({ id }).lean<StoredAlarmRule>();
    if (!rule) throw notFound('alarm_rule_not_found', 'There is no alarm rule with that id.');

    return rule;
  }

  public async create(deviceId: string, body: AlarmRuleCreate): Promise<StoredAlarmRule> {
    const rule: StoredAlarmRule = {
      ...body,
      id: uuidv4(),
      createdAt: new Date(),
      deviceId,
      // A rule written here was written by a person; a preset's and the cloud's
      // own are made where they are decided.
      origin: 'human',
      presetId: null,
      presetKey: null,
      silencedUntil: null,
      state: { triggered: false, lastTriggeredAt: null, lastResolvedAt: null, extremeValue: null, lastSampleAt: null },
    };

    await this.rules.create(rule);
    return rule;
  }

  /**
   * An alert is the record of an episode and keeps the severity it was raised
   * with, so re-grading a rule leaves everything it has ever closed alone. What
   * is still open is not a record yet but a thing happening now, and how bad it
   * is is whatever the rule says today: the inbox, the coloured edge on its
   * card and the row of the routing grid the all-clear goes out on all read the
   * alert rather than the rule, so an open episode left at the old grade would
   * be the cloud saying two different things about one tent.
   */
  public async update(rule: StoredAlarmRule, body: AlarmRuleUpdate): Promise<StoredAlarmRule> {
    if (rule.origin === 'always' && body.watch !== undefined && !watchesTheSame(body.watch, rule.watch)) {
      throw conflict('always_rule_metric', 'The rule the cloud keeps for this device watches whether it is there. Disable it instead.');
    }

    const changed = await this.change(rule, body);
    if (body.severity !== undefined && body.severity !== rule.severity) {
      await this.alerts.updateMany({ ruleId: rule.id, resolvedAt: null }, { $set: { severity: body.severity } });
    }

    return changed;
  }

  /**
   * A rule the cloud keeps for every device is not a person's to remove - the
   * loop would write it again within the minute, which reads as a delete that
   * did not work. Disabling or silencing it says the same thing and holds.
   */
  public async remove(rule: StoredAlarmRule): Promise<void> {
    if (rule.origin === 'always') {
      throw conflict('always_rule_kept', 'The rule the cloud keeps for this device cannot be deleted. Disable or silence it instead.');
    }

    await this.rules.deleteOne({ id: rule.id });
    // Its open episode goes quiet rather than resolved: nothing is watching it
    // any more, and an all-clear would claim the reading came back.
    await this.alerts.updateMany({ ruleId: rule.id, resolvedAt: null }, { $set: { resolvedAt: new Date() } });
  }

  public silence(rule: StoredAlarmRule, forSeconds: number): Promise<StoredAlarmRule> {
    return this.change(rule, { silencedUntil: new Date(Date.now() + forSeconds * 1000) });
  }

  public unsilence(rule: StoredAlarmRule): Promise<StoredAlarmRule> {
    return this.change(rule, { silencedUntil: null });
  }

  private async change(rule: StoredAlarmRule, fields: Partial<StoredAlarmRule>): Promise<StoredAlarmRule> {
    const changed = await this.rules.findOneAndUpdate({ id: rule.id }, { $set: fields }, { new: true }).lean<StoredAlarmRule>();
    if (!changed) throw notFound('alarm_rule_not_found', 'There is no alarm rule with that id.');

    return changed;
  }
}

/**
 * Whether a watch still watches the thing the rule was written for. A band may
 * be moved and a duration may be changed; what the rule is *about* is what the
 * cloud's own rule may not be turned into something else.
 */
const watchesTheSame = (watch: AlarmWatch, current: AlarmWatch): boolean =>
  watch.kind === current.kind && watchedName(watch) === watchedName(current);
