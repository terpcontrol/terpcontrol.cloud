import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { DeviceService } from './device.service';
import { demoLogs } from '@utils/demo';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { DeviceAccessGuard, DeviceOwnerGuard } from '../../common/auth/device-access.guard';
import { AuthContext } from '../../common/auth/token.service';
import { zodBodyAsError } from '../../common/zod-validation.pipe';

/**
 * Severity arrives as a number from the app and as a numeric string from
 * firmware; it is stored as a number either way.
 */
const severity = z.union([
  z.number(),
  z
    .string()
    .trim()
    .min(1)
    .refine(value => Number.isFinite(Number(value)), { error: 'must be a number' }),
]);

/**
 * Everything but the message, the severity and the categories is optional, and
 * a client that has nothing to put in a field may say so with a null - which
 * the handler this replaces stored without comment.
 */
const entryFields = {
  title: z.string().nullish(),
  message: z.string().nullish(),
  severity,
  categories: z.array(z.string()).min(1),
  raw: z.boolean().nullish(),
  data: z.record(z.string(), z.unknown()).nullish(),
  images: z.array(z.string()).nullish(),
  deleted: z.boolean().nullish(),
};

const hasText = (entry: { title?: string; message?: string }) => !!entry.title || !!entry.message;

/**
 * A query flag, as clients actually send it: the webapp uses `1` and an empty
 * string, and the documented parameter should also read `false` as false rather
 * than as a non-empty string.
 */
const isTruthy = (value: string | undefined): boolean => value !== undefined && value !== '' && value !== 'false' && value !== '0';

/**
 * A falsy time is refused, as it always was: the diary is sorted by it. So is a
 * string that names no moment - anything else used to reach mongoose and fail
 * there as a 500. Epoch milliseconds as a string are a moment, though, and
 * mongoose read them as one.
 */
const namesAMoment = (value: string): boolean => {
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && value.trim() !== '') return asNumber !== 0;

  return !Number.isNaN(new Date(value).getTime());
};

const requiredTime = z.union([
  z.number().refine(value => value !== 0, { error: 'is required' }),
  z.string().min(1).refine(namesAMoment, { error: 'must be a time' }),
]);

const createLogSchema = z
  .object({ ...entryFields, time: requiredTime })
  .loose()
  .refine(hasText, { error: 'Invalid log entry payload' });

const updateLogSchema = z
  .object({ ...entryFields, time: requiredTime.optional() })
  .loose()
  .refine(hasText, { error: 'Invalid log entry payload' });

type LogEntry = z.infer<typeof createLogSchema>;
type LogEntryUpdate = z.infer<typeof updateLogSchema>;

@ApiTags('device diary')
@Controller('device/logs')
export class DeviceLogController {
  constructor(private readonly deviceService: DeviceService) {}

  @Get(':device_id')
  @UseGuards(DeviceAccessGuard)
  @ApiQuery({ name: 'from', required: false, description: 'Epoch milliseconds' })
  @ApiQuery({ name: 'to', required: false, description: 'Epoch milliseconds' })
  @ApiQuery({ name: 'deleted', required: false, description: 'Include entries that were deleted' })
  @ApiQuery({ name: 'categories', required: false, description: 'Comma-separated list' })
  @ApiOperation({ summary: 'The diary of a device, oldest entry first' })
  public async list(
    @CurrentUser() user: AuthContext,
    @Param('device_id') deviceId: string,
    @Query() query: { from?: string; to?: string; deleted?: string; categories?: string },
  ) {
    const logs = await this.deviceService.getDeviceLogs(
      deviceId,
      Number(query.from ?? 0),
      Number(query.to ?? 0),
      isTruthy(query.deleted),
      query.categories ? String(query.categories).split(',') : undefined,
    );

    return user.isDemo ? demoLogs(logs) : logs;
  }

  @Post(':device_id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @ApiOperation({ summary: 'Add an entry to the diary' })
  public async add(@Param('device_id') deviceId: string, @Body(zodBodyAsError(createLogSchema)) body: LogEntry) {
    await this.deviceService.logMessage(deviceId, { ...body, severity: Number(body.severity) });
    return { status: 'ok' };
  }

  @Put(':device_id/:log_id')
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @ApiOperation({ summary: 'Edit a diary entry' })
  public async update(
    @CurrentUser() user: AuthContext,
    @Param('device_id') deviceId: string,
    @Param('log_id') logId: string,
    @Body(zodBodyAsError(updateLogSchema)) body: LogEntryUpdate,
  ) {
    await this.deviceService.updateDeviceLog(deviceId, user.userId, user.isAdmin, logId, { ...body, severity: Number(body.severity) });
    return { status: 'ok' };
  }

  @Delete(':device_id/:log_id')
  @UseGuards(AuthGuard, DeviceOwnerGuard)
  @ApiOperation({ summary: 'Delete one diary entry' })
  public async remove(@CurrentUser() user: AuthContext, @Param('device_id') deviceId: string, @Param('log_id') logId: string) {
    await this.deviceService.deleteDeviceLog(deviceId, user.userId, user.isAdmin, logId);
    return { status: 'ok' };
  }

  // Only a session is required: the service scopes the write to devices the
  // caller owns, so a device that is not theirs is left alone.
  @Delete(':device_id')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Mark the whole diary of one of the caller´s devices as deleted' })
  public async clear(@CurrentUser() user: AuthContext, @Param('device_id') deviceId: string) {
    await this.deviceService.deleteDeviceLogs(deviceId, user.userId);
    return { status: 'ok' };
  }
}
