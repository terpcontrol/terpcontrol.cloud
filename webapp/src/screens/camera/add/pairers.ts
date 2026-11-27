import type { Device } from '@fg2/shared-types/v1';

/**
 * The devices a Terp Cam is paired at: every one with a display, each with a
 * "Terp Cam" entry in its menu, which hands the cam its Wi-Fi and bridges it to
 * the cloud. A fridge module does exactly what a controller does here, and for
 * most growers it is the only device they have; an AIR fan, a lamp module and a
 * Plantalytix Socket pair one the same way, so an account with only those is not
 * told it has nothing to pair at.
 */
const PAIRS_AT: string[] = ['fridge', 'controller', 'fan', 'light', 'plug'];

export const pairsACam = (device: Pick<Device, 'type'>): boolean => PAIRS_AT.includes(device.type);

export const pairersOf = (devices: Device[]): Device[] => devices.filter(pairsACam);
