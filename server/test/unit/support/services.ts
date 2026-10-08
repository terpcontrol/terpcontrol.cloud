import { AccessService } from '@common/v1/access.service';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { HardwareReportService } from '@modules/device-protocol/hardware-report.service';
import { DevicesService } from '@modules/v1/device/devices.service';
import { ClimatePresets } from '@modules/v1/grow/climate-presets.port';
import { GrowsService } from '@modules/v1/grow/grows.service';
import { PhaseWriterService } from '@modules/v1/phase/phase-writer.service';
import { SpacesService } from '@modules/v1/space/spaces.service';
import { V1TestDatabase } from './v1-database';

/**
 * The services most specs build on, wired over the spec's database the way Nest
 * wires them. A spec passes what it holds on to or replaces; the rest is made
 * here.
 */

export const accessOn = (db: V1TestDatabase): AccessService =>
  new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);

export const devicesOn = (db: V1TestDatabase, access: AccessService, hardware: HardwareReportService | null = null): DevicesService =>
  new DevicesService(db.devices, db.claimCodes, db.spaces, db.memberships, db.cameras, db.plans, db.alarmRules, access, null, hardware);

export const spacesOn = (db: V1TestDatabase, access: AccessService, devices = devicesOn(db, access)): SpacesService =>
  new SpacesService(db.spaces, db.memberships, db.invites, db.shareLinks, db.devices, db.cameras, db.grows, devices, access);

export const growsOn = (
  db: V1TestDatabase,
  access: AccessService,
  {
    writer = new EntryWriterService(db.entries),
    phases = new PhaseWriterService(db.grows, writer, db.entries, db.devices),
    presets = null,
  }: { writer?: EntryWriterService; phases?: PhaseWriterService; presets?: ClimatePresets | null } = {},
): GrowsService =>
  new GrowsService(db.grows, db.plants, db.devices, db.memberships, db.spaces, db.users, db.shareLinks, db.entries, access, phases, writer, presets);
