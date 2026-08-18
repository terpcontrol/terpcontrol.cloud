import { Component, Input } from '@angular/core';

/**
 * "Connected devices" card: mounts the one webcam and — for device types
 * running the socket firmware (controller + fridge) — the smart sockets.
 * All logic lives in the two child components.
 */
@Component({
  selector: 'aux-devices',
  templateUrl: './aux-devices.component.html',
})
export class AuxDevicesComponent {
  @Input() deviceId = '';
  @Input() deviceType = '';
  @Input() cloudSettings: any = {};
  @Input() hardwareInfo: Record<string, string> | undefined;
  @Input() lastseen: number | undefined;

  /** Controllers AND fridges drive smart sockets (both run the socket firmware). */
  get supportsSockets(): boolean {
    return ['controller', 'fridge', 'fridge2'].includes(this.deviceType);
  }
}
