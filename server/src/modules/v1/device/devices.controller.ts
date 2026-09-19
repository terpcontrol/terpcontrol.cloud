import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  Device,
  DeviceClaimCreate,
  DeviceClaimResult,
  DeviceCommand,
  DeviceCommandResult,
  DeviceConfigurationEnvelope,
  DeviceLive,
  DevicePage,
  DeviceSeries,
  DeviceUpdate,
  FirmwarePage,
  SocketPage,
  SocketRole,
  SocketOverrideUpdate,
  SocketTestCreate,
  SocketUpdate,
} from '@fg2/shared-types/v1';
import {
  device as deviceShape,
  deviceClaimCreate,
  deviceClaimResult,
  deviceCommand,
  deviceCommandResult,
  deviceConfigurationEnvelope,
  deviceLive,
  devicePage,
  deviceSeries,
  deviceUpdate,
  firmwarePage,
  metric,
  outputMetric,
  seriesQuery,
  socketOverrideUpdate,
  socketPage,
  socketRole as socketRoleSchema,
  socketTestCreate,
  socketUpdate,
} from '@fg2/shared-types/v1-schemas';
import { AuthGuard } from '@common/auth/auth.guard';
import { AccessGuard, Caller, Requires } from '@common/v1/access.guard';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { badRequest } from '@common/v1/problem';
import { PageQuery, V1Query, pageQuery } from '@common/v1/validation';
import { V1Body } from '@common/zod-validation.pipe';
import { demoSockets } from '@utils/demo';
import { DeviceConfigurationService } from '@modules/device-protocol/device-configuration.service';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import { decodeCapabilities, decodeSockets } from '@modules/device-protocol/sockets';
import { DataService } from '@modules/data/data.service';
import { V1Answer } from '../answer-shape';
import { FleetService } from '../fleet/fleet.service';
import { DevicesService } from './devices.service';
import { setpointsOf } from './setpoints';

/**
 * A device, and everything a person does to one.
 *
 * Nothing here speaks the device's own vocabulary: a command is a typed union
 * that the protocol module translates, the configuration document is passed
 * through untouched, and a socket is a typed view of the hardware report that is
 * never stored twice.
 */

const deviceListQuery = pageQuery.extend({ spaceId: z.string().optional() });

/**
 * The contract's series request as a query string carries it: a repeated
 * parameter arrives as one value or as many, and every number as text. The
 * shape itself is the contract's; only how the wire spells it is said here.
 */
const one = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

const seriesFromQuery = seriesQuery.extend({
  // The contract's list of metrics may be empty, and a caller that wants only
  // what an output did - the level a dimmable light is running at - names none:
  // a metric asked for and thrown away is a second field read off the store.
  metrics: z
    .union([metric, z.array(metric)])
    .transform(one)
    .optional(),
  outputs: z
    .union([outputMetric, z.array(outputMetric)])
    .transform(one)
    .optional(),
  stepSeconds: z.coerce.number().int().positive().optional(),
});

@ApiTags('devices')
@Controller('v1/devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly fleet: FleetService,
    private readonly data: DataService,
    private readonly publisher: DevicePublisherService,
    private readonly configuration: DeviceConfigurationService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The devices this account can see' })
  @V1Answer(devicePage)
  public list(@Caller() ctx: AccessContext, @V1Query(deviceListQuery) query: z.infer<typeof deviceListQuery>): Promise<DevicePage> {
    return this.devices.list(ctx, query, query.spaceId);
  }

  /**
   * Claiming is the one route about a device that no `access()` decision can be
   * made for: the caller has no relation to the device yet, and the code the
   * display shows is the whole proof.
   */
  @Post('claims')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Claim a device with the code on its display' })
  @V1Answer(deviceClaimResult, { status: HttpStatus.CREATED })
  public claim(@Caller() ctx: AccessContext, @V1Body(deviceClaimCreate) body: DeviceClaimCreate): Promise<DeviceClaimResult> {
    return this.devices.claim(ctx, body);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('view', 'device')
  @ApiOperation({ summary: 'One device' })
  @V1Answer(deviceShape)
  public async read(@Caller() ctx: AccessContext, @Param('id') id: string): Promise<Device> {
    return this.devices.serialise(await this.devices.require(id), ctx.isDemo);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'device')
  @ApiOperation({ summary: 'Rename a device, move it, or change how it updates' })
  @V1Answer(deviceShape)
  public async update(@Caller() ctx: AccessContext, @Param('id') id: string, @V1Body(deviceUpdate) body: DeviceUpdate): Promise<Device> {
    // Moving a device is managing two places, and the guard above has only
    // decided about the one it is standing in.
    if (body.spaceId) await this.access.require(ctx, subjectRef('space', body.spaceId), 'manage');

    return this.devices.serialise(await this.devices.update(id, body), ctx.isDemo);
  }

  /**
   * Giving a device up is not deleting it: the hardware is still out there and
   * claimable by whoever stands in front of it next.
   */
  @Delete(':id/claim')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('own', 'device')
  @ApiOperation({ summary: 'Give a device up' })
  @ApiNoContentResponse({ description: 'The device is unclaimed and claimable again.' })
  public releaseClaim(@Param('id') id: string): Promise<void> {
    return this.devices.releaseClaim(id);
  }

  @Get(':id/configuration')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('view', 'device')
  @ApiOperation({ summary: "The device's own configuration document" })
  @V1Answer(deviceConfigurationEnvelope)
  public async readConfiguration(@Param('id') id: string): Promise<DeviceConfigurationEnvelope> {
    const device = await this.devices.require(id);
    return { configuration: device.configuration ?? {} };
  }

  /**
   * Replaced whole rather than patched: its keys belong to the firmware of that
   * type and the server does not read enough of one to merge two.
   */
  @Put(':id/configuration')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'device')
  @ApiOperation({ summary: "Replace the device's configuration document" })
  @V1Answer(deviceConfigurationEnvelope)
  public async writeConfiguration(
    @Param('id') id: string,
    @V1Body(deviceConfigurationEnvelope) body: DeviceConfigurationEnvelope,
  ): Promise<DeviceConfigurationEnvelope> {
    await this.configuration.replace(id, body.configuration);
    return { configuration: body.configuration };
  }

  /**
   * Nothing is stored or retried: the caller is waiting, and a device that is
   * not listening was not there to hear it. The answer says when the command
   * went out and whether anybody was listening, never that the device obeyed.
   */
  @Post(':id/commands')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'device')
  @ApiOperation({ summary: 'Tell a device to do something now' })
  @V1Answer(deviceCommandResult, { status: HttpStatus.ACCEPTED, description: 'Published. What the device does with it is its own.' })
  public async command(@Param('id') id: string, @V1Body(deviceCommand) body: DeviceCommand): Promise<DeviceCommandResult> {
    return published(await this.publisher.command(id, body));
  }

  @Get(':id/firmwares')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('view', 'device')
  @ApiOperation({ summary: 'The builds this device can be put on' })
  @V1Answer(firmwarePage)
  public async firmwares(@Param('id') id: string, @V1Query(pageQuery) query: PageQuery): Promise<FirmwarePage> {
    const device = await this.devices.require(id);
    // A device with no class yet has no builds of its own rather than every
    // build this cloud holds.
    return device.classId ? this.fleet.listFirmwares(query, device.classId) : { items: [], nextCursor: null };
  }

  @Get(':id/live')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('view', 'device')
  @ApiOperation({ summary: 'The newest reading of everything this device measures' })
  @V1Answer(deviceLive)
  public async live(@Param('id') id: string): Promise<DeviceLive> {
    const device = await this.devices.require(id);
    const reading = await this.data.live(id);

    return { deviceId: id, metrics: reading.metrics, setpoints: setpointsOf(device.configuration, reading.isDay) };
  }

  /** A window of history. The range and the step are answered back, because the server may have narrowed either. */
  @Get(':id/series')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('view', 'device')
  @ApiOperation({ summary: 'A window of one device´s series' })
  @V1Answer(deviceSeries)
  public async series(@Param('id') id: string, @V1Query(seriesFromQuery) query: z.infer<typeof seriesFromQuery>): Promise<DeviceSeries> {
    await this.devices.require(id);

    return this.data.series(id, {
      metrics: query.metrics ?? [],
      outputs: query.outputs,
      startsAt: new Date(query.startsAt),
      endsAt: new Date(query.endsAt),
      stepSeconds: query.stepSeconds,
    });
  }

  /**
   * The sockets a device reports, with what its build announced it understands.
   * A row is a view of `state.hardware` and is never stored twice, so this
   * answers what the device last said rather than what it was last told.
   */
  @Get(':id/sockets')
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('view', 'device')
  @ApiOperation({ summary: 'The smart sockets this device drives' })
  @V1Answer(socketPage)
  public async sockets(@Caller() ctx: AccessContext, @Param('id') id: string): Promise<SocketPage> {
    const device = await this.devices.require(id);
    const sockets = decodeSockets(device.state.hardware, {
      stateChangedAt: device.state.socketStateChangedAt,
      // An override's row carries the seconds it had left when the table was
      // sent, so it is read against the instant the table arrived; without that
      // the countdown would read as full every time somebody looked.
      reportedAt: device.state.socketsReportedAt ?? undefined,
    });

    // One page, always: a device drives at most a table's worth of sockets.
    return { items: ctx.isDemo ? demoSockets(sockets) : sockets, nextCursor: null, capabilities: decodeCapabilities(device.state.hardware) };
  }

  @Put(':id/sockets/:slot')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'device')
  @ApiOperation({ summary: 'Pair a socket, re-address one, or give it a role and a timer' })
  @V1Answer(deviceCommandResult, { status: HttpStatus.ACCEPTED })
  public async setSocket(
    @Param('id') id: string,
    @Param('slot') slot: string,
    @V1Body(socketUpdate) body: SocketUpdate,
  ): Promise<DeviceCommandResult> {
    return published(await this.publisher.command(id, { kind: 'socket_set', slot: slotOf(slot), ...body }));
  }

  @Delete(':id/sockets/:slot')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'device')
  @ApiOperation({ summary: 'Remove a socket from the device´s table' })
  @V1Answer(deviceCommandResult, { status: HttpStatus.ACCEPTED })
  public async removeSocket(@Param('id') id: string, @Param('slot') slot: string): Promise<DeviceCommandResult> {
    return published(await this.publisher.socketAction(id, 'socket_remove', numberOrRole(slot)));
  }

  @Put(':id/sockets/:slot/override')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'device')
  @ApiOperation({ summary: 'Force a socket on or off for a while' })
  @V1Answer(deviceCommandResult, { status: HttpStatus.ACCEPTED })
  public async overrideSocket(
    @Param('id') id: string,
    @Param('slot') slot: string,
    @V1Body(socketOverrideUpdate) body: SocketOverrideUpdate,
  ): Promise<DeviceCommandResult> {
    const command = { kind: 'socket_override', subject: { type: 'socket', id: slot }, ...body } as const;
    return published(await this.publisher.command(id, command));
  }

  @Delete(':id/sockets/:slot/override')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'device')
  @ApiOperation({ summary: 'Hand a socket back to its role´s control law' })
  @V1Answer(deviceCommandResult, { status: HttpStatus.ACCEPTED })
  public async clearSocketOverride(@Param('id') id: string, @Param('slot') slot: string): Promise<DeviceCommandResult> {
    // `auto` is how the firmware is told to stop overriding; the seconds are
    // what the override would have lasted and are ignored for `auto`.
    const command = { kind: 'socket_override', subject: { type: 'socket', id: slot }, state: 'auto', forSeconds: 0 } as const;
    return published(await this.publisher.command(id, command));
  }

  /**
   * Switching a socket on for a moment is how a person finds out which plug in
   * the tent it is. The firmware puts it back when the time is up, so a test
   * that is never answered still ends.
   */
  @Post(':id/sockets/:slot/tests')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AuthGuard, AccessGuard)
  @Requires('manage', 'device')
  @ApiOperation({ summary: 'Switch a socket on for a moment to find it' })
  @V1Answer(deviceCommandResult, { status: HttpStatus.ACCEPTED })
  public async testSocket(
    @Param('id') id: string,
    @Param('slot') slot: string,
    @V1Body(socketTestCreate) _body: SocketTestCreate,
  ): Promise<DeviceCommandResult> {
    // `forSeconds` is how long the caller is going to show the socket as being
    // tested. The command on the wire carries no duration - the firmware runs
    // its own test and puts the socket back itself, which is what makes a test
    // that is never answered still end.
    return published(await this.publisher.socketAction(id, 'socket_test', numberOrRole(slot)));
  }
}

const published = (result: { publishedAt: Date; deviceOnline: boolean }): DeviceCommandResult => ({
  publishedAt: result.publishedAt.toISOString(),
  deviceOnline: result.deviceOnline,
});

/** A slot is a number in the path; `new` adds a socket to the role rather than configuring one it has. */
const slotOf = (slot: string): number | null => {
  if (slot === 'new') return null;
  if (!/^\d+$/.test(slot)) {
    throw badRequest('socket_unknown', 'A socket is named by the slot it sits in, or by `new` to add one to a role.');
  }

  return Number(slot);
};

/**
 * The two commands that address a row of the reported table take a slot or, on a
 * build that reports no table, the role - which is the only address there is
 * there. A path segment that is neither is refused rather than sent on as a
 * role the firmware would drop without a word.
 */
const numberOrRole = (slot: string): number | SocketRole => {
  if (/^-?\d+$/.test(slot)) return Number(slot);

  const role = socketRoleSchema.safeParse(slot);
  if (!role.success) throw badRequest('socket_unknown', `There is no socket role called ${slot}.`);

  return role.data;
};
