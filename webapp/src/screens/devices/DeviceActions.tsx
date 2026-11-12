import type { ReactNode } from 'react';
import type { Device } from '@fg2/shared-types/v1';

/**
 * "Wartung · 15 Min" and "Neu starten" side by side: what is done to the
 * hardware itself, on the device's card under Steuerung and on its own page.
 * A device nobody hears takes neither, and one sentence says so.
 */
export function DeviceActions(_props: { device: Device; offline: boolean }): ReactNode {
  return null;
}

/** "Update auf 2.5.0": the newer build a device is owed or offered, installed on the tap; nothing where there is none. */
export function UpdateButton(_props: { device: Device; offline: boolean }): ReactNode {
  return null;
}
