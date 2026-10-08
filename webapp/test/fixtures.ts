import type { Device } from '@fg2/shared-types/v1';

const BASE: Device = {
  id: 'device-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  type: 'controller',
  classId: null,
  serialNumber: 42,
  ownerId: 'user-1',
  spaceId: 'space-1',
  name: null,
  firmware: { channel: 'stable', targetId: null },
  configuration: null,
  settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
  control: null,
  isDemo: false,
  state: {
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    claimedAt: '2026-01-01T00:00:00.000Z',
    firmwareId: null,
    updateStartedAt: null,
    updateEndedAt: null,
    updateFailedAt: null,
    maintenanceUntil: null,
    hardware: {},
    socketStateChangedAt: {},
    socketsReportedAt: null,
  },
};

/** A claimed controller in the reader's own tent, with what a test is about set over it; `state` is merged rather than replaced. */
export const deviceWith = ({ state, ...over }: Partial<Omit<Device, 'state'>> & { state?: Partial<Device['state']> } = {}): Device => ({
  ...BASE,
  ...over,
  state: { ...BASE.state, ...state },
});
