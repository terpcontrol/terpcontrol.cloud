import { DateTime } from 'luxon';
import type { Camera, Device, DeviceClass, Firmware, User } from '@fg2/shared-types/v1';

/**
 * The fleet table's rows, worked out away from the screen that draws them.
 *
 * Every column here is a field some answer of the API carries: the device list
 * for what a device is and when it last spoke, the account page for the handle
 * behind an owner's id, the camera list for how many cams hang off a
 * controller, the class list for which build a class calls stable. Nothing is
 * inferred that the server did not say - a column the API does not answer is
 * not on this row and not on the board we drew from it.
 *
 * A standalone Terp Cam is a row as well, because it is hardware on this fleet
 * that no controller answers for; one paired to a controller is counted in that
 * controller's `cams` instead, which is the only place it would otherwise be
 * missed.
 */

/** Offline for longer than this is what the board's second chip filters on. */
export const QUIET_HOURS = 24;

export type FleetKind = 'device' | 'camera';

export interface FleetRow {
  id: string;
  kind: FleetKind;
  name: string | null;
  /** The firmware's own type name for a device, and the camera kind for a cam. Never an enum this app closes. */
  type: string;
  ownerId: string | null;
  /** The owner's handle, or null while the device is unclaimed and claimable. */
  ownerHandle: string | null;
  /** What the hardware reports it is running: a build uuid, which cannot be compared with another. */
  firmwareId: string | null;
  /** The name that build was registered under, where this install has a record of it. */
  firmwareName: string | null;
  lastSeenAt: string | null;
  /** How many smart sockets the device says it has paired; null for a build that reports none and for a camera. */
  sockets: number | null;
  /** How many cams answer through this device; null on a camera's own row. */
  cams: number | null;
  /** Whether the build it reports is the one its class calls stable; null where the class points nowhere yet. */
  onStable: boolean | null;
  /** Where the row opens: the place the device stands in, or the camera's own page. */
  opens: string | null;
}

export interface FleetFilter {
  /** A device type, or null for every type. */
  type: string | null;
  quiet: boolean;
  behind: boolean;
  search: string;
}

export const NO_FILTER: FleetFilter = { type: null, quiet: false, behind: false, search: '' };

/** How many sockets the device last said it has. It is the device's own report, so a build that sends none has none here. */
const socketsOf = (device: Device): number | null => {
  const reported = Number(device.state.hardware.sockets_n);

  return Number.isFinite(reported) ? reported : null;
};

const handleOf = (ownerId: string | null, people: Map<string, User>): string | null => (ownerId && people.get(ownerId)?.handle) || null;

export interface FleetSources {
  devices: Device[];
  cameras: Camera[];
  classes: DeviceClass[];
  firmwares: Firmware[];
  people: Map<string, User>;
}

/**
 * One row per piece of hardware, the ones heard from most recently first.
 *
 * That order is the operator's: a fleet is read to find what has stopped
 * talking, and the ones that never have - a device made by hand, a camera that
 * has delivered nothing - belong at the end of it rather than at the top where
 * an empty date would sort them.
 */
export const fleetRows = ({ devices, cameras, classes, firmwares, people }: FleetSources): FleetRow[] => {
  const stable = new Map(classes.map(one => [one.id, one.firmwareIds.stable]));
  const builds = new Map(firmwares.map(one => [one.id, one]));
  const camsOf = (deviceId: string) => cameras.filter(camera => camera.deviceId === deviceId).length;

  const deviceRows: FleetRow[] = devices.map(device => {
    const calledStable = device.classId ? (stable.get(device.classId) ?? null) : null;

    return {
      id: device.id,
      kind: 'device',
      name: device.name,
      type: device.type,
      ownerId: device.ownerId,
      ownerHandle: handleOf(device.ownerId, people),
      firmwareId: device.state.firmwareId,
      firmwareName: (device.state.firmwareId && builds.get(device.state.firmwareId)?.name) || null,
      lastSeenAt: device.state.lastSeenAt,
      sockets: socketsOf(device),
      cams: camsOf(device.id),
      onStable: calledStable === null ? null : device.state.firmwareId === calledStable,
      opens: device.spaceId ? `/spaces/${device.spaceId}/devices` : null,
    };
  });

  // Only the standalone ones. A cam that hangs off a controller is that
  // controller's row, and an RTSP stream is somebody's own camera that this
  // cloud merely pulls - neither is a thing a firmware rollout reaches.
  const cameraRows: FleetRow[] = cameras
    .filter(camera => camera.kind === 'terpcam_standalone' && camera.removedAt === null)
    .map(camera => ({
      id: camera.id,
      kind: 'camera',
      name: camera.name,
      type: camera.kind,
      ownerId: camera.ownerId,
      ownerHandle: handleOf(camera.ownerId, people),
      firmwareId: camera.state.firmwareVersion,
      firmwareName: null,
      lastSeenAt: camera.state.lastStillAt,
      sockets: null,
      cams: null,
      onStable: null,
      opens: `/cameras/${camera.id}`,
    }));

  return [...deviceRows, ...cameraRows].sort((one, other) => heard(other.lastSeenAt) - heard(one.lastSeenAt));
};

const heard = (lastSeenAt: string | null): number => (lastSeenAt ? DateTime.fromISO(lastSeenAt).toMillis() : 0);

/** Every type in the fleet, for the chip that narrows to one. Sorted, so the menu does not move as devices come and go. */
export const typesOf = (rows: FleetRow[]): string[] => [...new Set(rows.map(row => row.type))].sort();

/**
 * The board's four chips, applied together. The search reads what is on the
 * row - its id, its name, its owner's handle - and nothing that is not drawn:
 * an address is on no row here and is searchable on no screen but the accounts.
 */
export const filteredRows = (rows: FleetRow[], filter: FleetFilter, now: DateTime): FleetRow[] => {
  const needle = filter.search.trim().toLowerCase().replace(/^@/, '');
  const quietBefore = now.minus({ hours: QUIET_HOURS });

  return rows.filter(row => {
    if (filter.type !== null && row.type !== filter.type) return false;
    if (filter.quiet && !isQuiet(row, quietBefore)) return false;
    if (filter.behind && row.onStable !== false) return false;
    if (!needle) return true;

    return [row.id, row.name ?? '', row.ownerHandle ?? ''].some(field => field.toLowerCase().includes(needle));
  });
};

/** Nothing for a day, which includes the hardware that has never said anything at all. */
const isQuiet = (row: FleetRow, before: DateTime): boolean => row.lastSeenAt === null || DateTime.fromISO(row.lastSeenAt) < before;
