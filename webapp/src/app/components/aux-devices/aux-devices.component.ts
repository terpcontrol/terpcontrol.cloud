import { Component, Input } from '@angular/core';
import { socketRolesFor } from 'src/app/util/socket-info';

/**
 * "Connected devices" card: mounts the one webcam and — for device types
 * whose firmware drives smart sockets — the smart sockets.
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

  get supportsSockets(): boolean {
    return socketRolesFor(this.deviceType).length > 0;
  }
}
