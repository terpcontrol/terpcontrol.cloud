/**
 * Putting a device into maintenance, which is what "in the tent 15 min" comes to.
 *
 * The command, its topic and the minutes the firmware counts in belong to the
 * frozen device protocol, so the diary names only the window it wants and the
 * protocol module (`DevicePublisherService.startMaintenance`) does the saying.
 */
export interface MaintenancePort {
  /**
   * Quiet on this device until the window is up. It never throws: a broker that
   * is down is a device that will not hear, not a reason to lose the entry the
   * person wrote.
   */
  startMaintenance(deviceId: string, forSeconds: number): Promise<void>;
}

export const MAINTENANCE_STARTER = 'diary:maintenance-starter';
