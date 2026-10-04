import type { Device } from '@fg2/shared-types/v1';

/**
 * The devices a Terp Cam is paired at: the ones with a display and a "Terp Cam"
 * entry in its menu, which hand the cam their Wi-Fi and bridge it to the cloud.
 * A fridge module does exactly what a controller does here, and for most growers
 * it is the only device they have; an AIR fan and a Smart Socket pair one the
 * same way, so an account with only those is not told it has nothing to pair at.
 * A light module has no such entry.
 */
const PAIRS_AT: string[] = ['fridge', 'controller', 'fan', 'plug'];

export const pairsACam = (device: Pick<Device, 'type'>): boolean => PAIRS_AT.includes(device.type);

export const pairersOf = (devices: Device[]): Device[] => devices.filter(pairsACam);
