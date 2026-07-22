import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { DeviceService } from 'src/app/services/devices.service';

/**
 * The one delete-device action, shared by every settings page and both UI
 * modes: translated double-confirm, unclaim, back to the device list.
 */
@Component({
  selector: 'delete-device-row',
  template: `
    <ion-button class="delete-device-button" fill="clear" size="small" color="danger" (click)="deleteDevice()">
      <ion-icon slot="start" name="trash-outline" aria-hidden="true"></ion-icon>
      {{ 'settings.deleteDevice' | translate }}
    </ion-button>
  `,
  styles: [
    `
      .delete-device-button {
        margin: 18px 0 8px;
        opacity: 0.9;
      }
    `,
  ],
})
export class DeleteDeviceRowComponent {
  @Input() deviceId = '';

  constructor(
    private devices: DeviceService,
    private alertController: AlertController,
    private translate: TranslateService,
    private router: Router,
  ) {}

  async deleteDevice() {
    if (!(await this.confirmDelete(this.translate.instant('settings.deleteDeviceConfirmText')))) {
      return;
    }
    if (!(await this.confirmDelete(this.translate.instant('settings.deleteDeviceConfirmAgain')))) {
      return;
    }
    await this.devices.unclaim(this.deviceId);
    await this.router.navigateByUrl('/list', { replaceUrl: true });
  }

  private async confirmDelete(message: string): Promise<boolean> {
    const alert = await this.alertController.create({
      header: this.translate.instant('settings.deleteDeviceConfirmTitle'),
      message,
      buttons: [
        { text: this.translate.instant('misc.cancel'), role: 'cancel' },
        { text: this.translate.instant('settings.deleteDeviceConfirmButton'), role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'destructive';
  }
}
