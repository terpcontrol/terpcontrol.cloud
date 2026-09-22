import type { Device } from '@fg2/shared-types/v1';

/** Targets set by hand for the controllers of the tent. Filled in by its slice. */
export function Targets({ spaceId, devices, mayManage }: { spaceId: string; devices: Device[]; mayManage: boolean }) {
  void spaceId;
  void devices;
  void mayManage;
  return null;
}
