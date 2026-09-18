import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AlarmRule, AlarmRuleCreate, AlarmRulePage, AlarmRuleUpdate, AlarmSilence, Alert, AlertPage } from '@fg2/shared-types/v1';
import { alarmRule, alarmRuleCreate, alarmRulePage, alarmRuleUpdate, alarmSilence, alert, alertPage } from '@fg2/shared-types/v1-schemas';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { AuthGuard } from '@common/auth/auth.guard';
import { AccessGuard, Caller, Requires } from '@common/v1/access.guard';
import { AccessService } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { pageLimit } from '@common/v1/pages';
import { notFound } from '@common/v1/problem';
import { PageQuery, V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { V1Answer } from '../v1/answer-shape';
import { AlarmRuleService } from './alarm-rule.service';
import { AlertInboxService } from './alert-inbox.service';
import { alarmRuleOf, alertOf } from './alarm.wire';

/**
 * The routes of the alarms: the rules of one device, a rule of its own, and the
 * alerts they have raised.
 *
 * A rule is read by whoever may see the device and written by whoever may manage
 * it - and `delivery.custom`, which names a host on somebody's home network, is
 * answered only to the second.
 */

/** `true` and `false` are words in a query string, and every non-empty word is a truthy boolean. */
const alertQuery = pageQuery.extend({
  deviceId: z.string().optional(),
  spaceId: z.string().optional(),
  open: z.enum(['true', 'false']).optional(),
});

type AlertQuery = z.infer<typeof alertQuery>;

@ApiTags('alarms')
@Controller('v1/devices/:id/alarm-rules')
@UseGuards(AuthGuard, AccessGuard)
export class DeviceAlarmRulesController {
  constructor(
    private readonly rules: AlarmRuleService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @Requires('view', 'device')
  @ApiOperation({ summary: 'The alarm rules watching this device' })
  @V1Answer(alarmRulePage)
  public async list(@Param('id') deviceId: string, @V1Query(pageQuery) query: PageQuery, @Caller() caller: AccessContext): Promise<AlarmRulePage> {
    const limit = pageLimit(query.limit);
    const page = await this.rules.list(deviceId, query, limit);
    const mayManage = !!(await this.access.access(caller, { type: 'device', id: deviceId }, 'manage'));

    return { items: page.items.map(rule => alarmRuleOf(rule, mayManage)), nextCursor: page.nextCursor };
  }

  @Post()
  @Requires('manage', 'device')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Watch one more thing about this device' })
  @V1Answer(alarmRule, { status: HttpStatus.CREATED })
  public async create(@Param('id') deviceId: string, @V1Body(alarmRuleCreate) body: AlarmRuleCreate): Promise<AlarmRule> {
    return alarmRuleOf(await this.rules.create(deviceId, body), true);
  }
}

@ApiTags('alarms')
@Controller('v1/alarm-rules/:id')
@UseGuards(AuthGuard)
export class AlarmRulesController {
  constructor(
    private readonly rules: AlarmRuleService,
    private readonly access: AccessService,
  ) {}

  @Patch()
  @ApiOperation({ summary: 'Change what a rule watches for' })
  @V1Answer(alarmRule)
  public async update(@Param('id') id: string, @V1Body(alarmRuleUpdate) body: AlarmRuleUpdate, @Caller() caller: AccessContext): Promise<AlarmRule> {
    const rule = await this.manageable(caller, id);
    return alarmRuleOf(await this.rules.update(rule, body), true);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop watching' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Gone.' })
  public async remove(@Param('id') id: string, @Caller() caller: AccessContext): Promise<void> {
    await this.rules.remove(await this.manageable(caller, id));
  }

  @Put('silence')
  @ApiOperation({ summary: 'Keep watching, but say nothing for a while' })
  @V1Answer(alarmRule)
  public async silence(@Param('id') id: string, @V1Body(alarmSilence) body: AlarmSilence, @Caller() caller: AccessContext): Promise<AlarmRule> {
    const rule = await this.manageable(caller, id);
    return alarmRuleOf(await this.rules.silence(rule, body.forSeconds), true);
  }

  @Delete('silence')
  @ApiOperation({ summary: 'Say it again from now on' })
  @V1Answer(alarmRule)
  public async unsilence(@Param('id') id: string, @Caller() caller: AccessContext): Promise<AlarmRule> {
    return alarmRuleOf(await this.rules.unsilence(await this.manageable(caller, id)), true);
  }

  /** A rule belongs to its device, so what may be done to it is what may be done to that device. */
  private async manageable(caller: AccessContext, id: string): Promise<StoredAlarmRule> {
    const rule = await this.rules.byId(id);
    await this.access.require(caller, { type: 'device', id: rule.deviceId }, 'manage');

    return rule;
  }
}

@ApiTags('alarms')
@Controller('v1/alerts')
@UseGuards(AuthGuard)
export class AlertsController {
  constructor(
    private readonly inbox: AlertInboxService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'What has gone wrong, newest first' })
  @V1Answer(alertPage)
  public async list(@V1Query(alertQuery) query: AlertQuery, @Caller() caller: AccessContext): Promise<AlertPage> {
    if (query.deviceId) await this.access.require(caller, { type: 'device', id: query.deviceId }, 'view');
    if (query.spaceId) await this.access.require(caller, { type: 'space', id: query.spaceId }, 'view');

    const where = await this.inbox.scope(caller, { deviceId: query.deviceId, spaceId: query.spaceId, open: openOf(query) });
    if (!where) return { items: [], nextCursor: null };

    const limit = pageLimit(query.limit);
    const page = await this.inbox.list(where, query.cursor, limit);

    return { items: page.items.map(alertOf), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @ApiOperation({ summary: 'One alert, from what raised it to what ended it' })
  @V1Answer(alert)
  public async read(@Param('id') id: string, @Caller() caller: AccessContext): Promise<Alert> {
    const alert = await this.inbox.byId(id);
    const subject = this.inbox.subjectOf(alert);
    // An alert about nothing that still exists is nobody's to read but an admin's.
    if (subject) await this.access.require(caller, subject, 'view');
    else if (!caller.isAdmin) throw notFound('alert_not_found', 'There is no alert with that id.');

    return alertOf(alert);
  }
}

const openOf = (query: AlertQuery): boolean | undefined => (query.open === undefined ? undefined : query.open === 'true');
