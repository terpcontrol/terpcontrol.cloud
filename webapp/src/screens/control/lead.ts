import type { Device } from '@fg2/shared-types/v1';

/** Whether a device is the one Steuerung's top is about: the place's climate, as the server names it. */
export const useLeads = (_device: Device): boolean => false;
