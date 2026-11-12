import type { ReactNode } from 'react';
import type { Device } from '@fg2/shared-types/v1';

/**
 * What one device is set to that is its own: the light and the targets of a
 * controller, a fridge or an AIR fan, the switching of a Plantalytix Socket,
 * the window of a LIGHT. Steuerung draws it for the device that is the
 * place's climate, a device's own page for every other one.
 */
export function OwnSettings(_props: { device: Device }): ReactNode {
  return null;
}
