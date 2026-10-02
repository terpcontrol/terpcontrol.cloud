import type { Device } from '@fg2/shared-types/v1';

/**
 * The devices a Terp Cam is paired at: the ones with a display and a "Terp Cam"
 * entry in its menu, which hand the cam their Wi-Fi and fetch its pictures for
 * the cloud. A fridge module does exactly what a controller does here, and for
 * most growers it is the only device they have.
 */
const PAIRS_AT: string[] = ['fridge', 'controller'];

export const pairersOf = (devices: Device[]): Device[] => devices.filter(device => PAIRS_AT.includes(device.type));
